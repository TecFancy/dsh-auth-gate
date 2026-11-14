/**
 * 从既有扁平配置派生 passkey（WebAuthn）运行参数。纯函数、无 IO、无日志：调用方
 * （root 侧装配）负责把 `enabled: false` 的 reason 记成 error 并按 off 处理（fail-closed），
 * `totpSatisfied` 只用于 info 提示，不做任何降级。
 *
 * 派生规则（任何一条不成立都返回对应的 disabled reason，绝不「尽力而为」）：
 * - `passkey === "off"` → `"off"`（优先级最高，此时不检查其它字段）。
 * - `publicHost` trim 后为空 → `"public-host-missing"`；没有 `://` 时按 `https://` 补齐；
 *   `new URL` 解析失败、非 http(s)、带 path/query/fragment 或 userinfo → `"public-host-invalid"`。
 * - `rpId = passkeyRpId || hostname(publicHost)`（显式值 trim 后小写）。它必须是域名形状：
 *   无 scheme/端口/路径、非 IP 字面量、非空标签且每段合法；单标签只允许 `localhost`。
 *   否则 `"rp-id-invalid"`，因此「publicHost 是 IP 且未显式配 rpId」也落在这里。
 * - origins：`passkeyOrigins` 为空数组时取 `[origin(publicHost)]`，否则逐项使用显式列表
 *   （显式列表**不**自动并入 publicHost 的 origin）。每项必须是绝对 URL，scheme 为 `https:`，
 *   或 `http:` 且 hostname 恰为 `localhost`；hostname 必须等于 rpId 或以 `.` + rpId 结尾；
 *   path/query/fragment/userinfo 一并拒绝。任一不成立 → `"origin-invalid"`。
 *   输出统一为规范化后的 `URL.origin`（小写 host、去默认端口、去尾斜杠）。
 * - `totpSatisfied = totp !== "off"`：passkey 登录自带 UV，满足 TOTP 两因子策略，调用方只记 info。
 */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MAX_DOMAIN_LENGTH = 253;
/**
 * 把配置派生为 WebAuthn 参数。纯函数：同一输入恒得到同一输出，不读写外部状态。
 * 失败时返回 `enabled: false` 与固定 reason，由调用方记 error 并降级为 off。
 */
export function resolvePasskeySettings(input) {
    if (input.passkey === "off")
        return disabled("off");
    const configuredHost = input.publicHost.trim();
    if (configuredHost === "")
        return disabled("public-host-missing");
    const publicHost = parsePublicHost(configuredHost);
    if (publicHost === undefined)
        return disabled("public-host-invalid");
    const rpId = resolveRpId(input.passkeyRpId, publicHost.hostname);
    if (!isValidRpId(rpId))
        return disabled("rp-id-invalid");
    const origins = resolveOrigins(input.passkeyOrigins, publicHost, rpId);
    if (origins === undefined)
        return disabled("origin-invalid");
    return {
        enabled: true,
        rpId,
        rpName: input.passkeyRpName,
        origins,
        enforceCounter: input.passkeyEnforceCounter,
        conditionalUi: input.passkeyConditionalUi,
        totpSatisfied: input.totp !== "off",
    };
}
function disabled(reason) {
    return { enabled: false, reason };
}
/** 无 `://` 时按 https 补；解析失败、非 http(s)、带路径/查询/片段/userinfo → undefined。 */
function parsePublicHost(configuredHost) {
    const candidate = SCHEME_PREFIX.test(configuredHost)
        ? configuredHost
        : `https://${configuredHost}`;
    let url;
    try {
        url = new URL(candidate);
    }
    catch {
        return undefined;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
        return undefined;
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "")
        return undefined;
    if (url.username !== "" || url.password !== "")
        return undefined;
    return { origin: url.origin, hostname: url.hostname };
}
/** `passkeyRpId` 非空则用它（小写化），否则取 publicHost 的 hostname。 */
function resolveRpId(configuredRpId, hostname) {
    const explicit = configuredRpId.trim().toLowerCase();
    return explicit === "" ? hostname.toLowerCase() : explicit;
}
/** 域名形状校验：非 IP 字面量、无 scheme/端口/路径；单标签只允许 `localhost`。 */
function isValidRpId(rpId) {
    if (rpId.length === 0 || rpId.length > MAX_DOMAIN_LENGTH)
        return false;
    if (IPV4_LITERAL.test(rpId) || rpId.includes(":"))
        return false;
    const labels = rpId.split(".");
    const singleLabelAllowed = rpId === "localhost";
    if (labels.length === 1 && !singleLabelAllowed)
        return false;
    return labels.every((label) => DOMAIN_LABEL.test(label));
}
/**
 * 解析 origin 白名单。空列表取 publicHost 的 origin，否则逐项使用显式列表（顺序保留，
 * 不去重）；任一项非法或 hostname 不是 rpId 的域后缀 → undefined。
 */
function resolveOrigins(configuredOrigins, publicHost, rpId) {
    const candidates = configuredOrigins.length === 0 ? [publicHost.origin] : configuredOrigins;
    const origins = [];
    for (const candidate of candidates) {
        const parsed = parseOrigin(candidate);
        if (parsed === undefined || !hostMatchesRpId(parsed.hostname, rpId))
            return undefined;
        origins.push(parsed.origin);
    }
    return origins;
}
/** https，或 http 且 hostname 恰为 localhost（明文只豁免给本地开发）。 */
function isAllowedOriginScheme(url) {
    if (url.protocol === "https:")
        return true;
    return url.protocol === "http:" && url.hostname === "localhost";
}
/** 绝对 URL、无路径/查询/片段/userinfo，且 scheme 合法。 */
function parseOrigin(candidate) {
    let url;
    try {
        url = new URL(candidate.trim());
    }
    catch {
        return undefined;
    }
    if (!isAllowedOriginScheme(url))
        return undefined;
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "")
        return undefined;
    if (url.username !== "" || url.password !== "")
        return undefined;
    return { origin: url.origin, hostname: url.hostname };
}
/** origin 的 hostname 必须等于 rpId 或是其子域（W3C domain suffix 比较，不做通配）。 */
function hostMatchesRpId(hostname, rpId) {
    return hostname === rpId || hostname.endsWith(`.${rpId}`);
}
//# sourceMappingURL=passkey-config.js.map