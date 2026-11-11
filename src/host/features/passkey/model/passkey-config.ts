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

/** 派生 passkey 参数所需的配置子集（结构兼容 root 侧的 `AuthConfig`）。 */
export interface PasskeySettingsInput {
  /** 功能开关；`"off"` 时其余字段一律不参与派生。 */
  readonly passkey: "off" | "optional";
  /** RP ID 与 origin 的唯一锚点；绝不读请求头 `Host`。 */
  readonly publicHost: string;
  /** 浏览器 passkey 弹窗的 RP 展示名，不参与校验。 */
  readonly passkeyRpName: string;
  /** RP ID 覆盖值；`""` = 取 publicHost 的 hostname。 */
  readonly passkeyRpId: string;
  /** origin 精确白名单；`[]` = `[origin(publicHost)]`。 */
  readonly passkeyOrigins: string[];
  /** 计数器回退且凭证为设备绑定时是否拒绝；默认只 warn。 */
  readonly passkeyEnforceCounter: boolean;
  /** 登录页是否启用条件 UI（自动填充）。 */
  readonly passkeyConditionalUi: boolean;
  /** 既有 TOTP 策略；只影响 `totpSatisfied` 这个提示位。 */
  readonly totp: "off" | "optional" | "required";
}

/** 功能不可用的原因（进 error 日志的固定取值，不含配置原文）。 */
export type PasskeyDisabledReason =
  "off" | "public-host-missing" | "public-host-invalid" | "rp-id-invalid" | "origin-invalid";

/** 派生结果：`enabled: false` 时只有 reason，调用方按 off 处理。 */
export type PasskeySettings =
  | {
      readonly enabled: true;
      readonly rpId: string;
      readonly rpName: string;
      /** 规范化后的精确 origin 白名单（含 publicHost 派生项或显式列表）。 */
      readonly origins: string[];
      readonly enforceCounter: boolean;
      readonly conditionalUi: boolean;
      /** `totp !== "off"`：passkey 满足既有两因子策略，仅用于 info 日志。 */
      readonly totpSatisfied: boolean;
    }
  | { readonly enabled: false; readonly reason: PasskeyDisabledReason };

const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MAX_DOMAIN_LENGTH = 253;

/**
 * 把配置派生为 WebAuthn 参数。纯函数：同一输入恒得到同一输出，不读写外部状态。
 * 失败时返回 `enabled: false` 与固定 reason，由调用方记 error 并降级为 off。
 */
export function resolvePasskeySettings(input: PasskeySettingsInput): PasskeySettings {
  if (input.passkey === "off") return disabled("off");
  const configuredHost = input.publicHost.trim();
  if (configuredHost === "") return disabled("public-host-missing");
  const publicHost = parsePublicHost(configuredHost);
  if (publicHost === undefined) return disabled("public-host-invalid");
  const rpId = resolveRpId(input.passkeyRpId, publicHost.hostname);
  if (!isValidRpId(rpId)) return disabled("rp-id-invalid");
  const origins = resolveOrigins(input.passkeyOrigins, publicHost, rpId);
  if (origins === undefined) return disabled("origin-invalid");
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

function disabled(reason: PasskeyDisabledReason): PasskeySettings {
  return { enabled: false, reason };
}

/** publicHost 归一化后的对外身份：`origin` 用于 origin 白名单，`hostname` 用于派生 rpId。 */
interface ParsedPublicHost {
  readonly origin: string;
  readonly hostname: string;
}

/** 无 `://` 时按 https 补；解析失败、非 http(s)、带路径/查询/片段/userinfo → undefined。 */
function parsePublicHost(configuredHost: string): ParsedPublicHost | undefined {
  const candidate = SCHEME_PREFIX.test(configuredHost)
    ? configuredHost
    : `https://${configuredHost}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return { origin: url.origin, hostname: url.hostname };
}

/** `passkeyRpId` 非空则用它（小写化），否则取 publicHost 的 hostname。 */
function resolveRpId(configuredRpId: string, hostname: string): string {
  const explicit = configuredRpId.trim().toLowerCase();
  return explicit === "" ? hostname.toLowerCase() : explicit;
}

/** 域名形状校验：非 IP 字面量、无 scheme/端口/路径；单标签只允许 `localhost`。 */
function isValidRpId(rpId: string): boolean {
  if (rpId.length === 0 || rpId.length > MAX_DOMAIN_LENGTH) return false;
  if (IPV4_LITERAL.test(rpId) || rpId.includes(":")) return false;
  const labels = rpId.split(".");
  const singleLabelAllowed = rpId === "localhost";
  if (labels.length === 1 && !singleLabelAllowed) return false;
  return labels.every((label) => DOMAIN_LABEL.test(label));
}

/**
 * 解析 origin 白名单。空列表取 publicHost 的 origin，否则逐项使用显式列表（顺序保留，
 * 不去重）；任一项非法或 hostname 不是 rpId 的域后缀 → undefined。
 */
function resolveOrigins(
  configuredOrigins: readonly string[],
  publicHost: ParsedPublicHost,
  rpId: string,
): string[] | undefined {
  const candidates = configuredOrigins.length === 0 ? [publicHost.origin] : configuredOrigins;
  const origins: string[] = [];
  for (const candidate of candidates) {
    const parsed = parseOrigin(candidate);
    if (parsed === undefined || !hostMatchesRpId(parsed.hostname, rpId)) return undefined;
    origins.push(parsed.origin);
  }
  return origins;
}

/** 单个白名单项归一化后的结果。 */
interface ParsedOrigin {
  readonly origin: string;
  readonly hostname: string;
}

/** https，或 http 且 hostname 恰为 localhost（明文只豁免给本地开发）。 */
function isAllowedOriginScheme(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && url.hostname === "localhost";
}

/** 绝对 URL、无路径/查询/片段/userinfo，且 scheme 合法。 */
function parseOrigin(candidate: string): ParsedOrigin | undefined {
  let url: URL;
  try {
    url = new URL(candidate.trim());
  } catch {
    return undefined;
  }
  if (!isAllowedOriginScheme(url)) return undefined;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return { origin: url.origin, hostname: url.hostname };
}

/** origin 的 hostname 必须等于 rpId 或是其子域（W3C domain suffix 比较，不做通配）。 */
function hostMatchesRpId(hostname: string, rpId: string): boolean {
  return hostname === rpId || hostname.endsWith(`.${rpId}`);
}
