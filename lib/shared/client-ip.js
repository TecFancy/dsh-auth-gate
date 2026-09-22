import { cidrContains, normalizeIp, parseCidr } from "./ip-address.js";
/** 请求头值长度上限：单个 IP 足够、XFF 短链也够；超长一律回退，不给解析器喂垃圾。 */
const HEADER_VALUE_LIMIT = 256;
/** 默认只信回环：同主机反代是唯一「不用额外配置就正确」的形态。 */
export const DEFAULT_TRUSTED_PROXIES = ["127.0.0.0/8", "::1/128"];
function loopback() {
    return DEFAULT_TRUSTED_PROXIES.map((entry) => parseCidr(entry)).filter((network) => network !== undefined);
}
/**
 * 解析 D19 配置。**不抛错**：非法输入退化为**更窄**的信任（非法头名 → 不读头；非法 CIDR →
 * 只信回环），原因放进 `degraded` 交给调用方打日志：配置写错绝不能让守卫卸载或放宽。
 * 前缀长度 0（`0.0.0.0/0`、`::/0`）等于「信任所有人」，一律拒绝。
 */
export function parseClientIpPolicy(header, cidrs) {
    const name = (header ?? "").trim().toLowerCase();
    if (name === "")
        return { header: "", trusted: loopback(), degraded: undefined };
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
        return { header: "", trusted: loopback(), degraded: `invalid clientIpHeader "${name}"` };
    }
    const entries = cidrs ?? [];
    const parsed = [];
    for (const entry of entries) {
        const network = parseCidr(entry);
        if (network !== undefined && network.prefix > 0)
            parsed.push(network);
    }
    if (parsed.length === 0) {
        return {
            header: name,
            trusted: loopback(),
            degraded: "trustedProxyCidrs unusable: trusting loopback only",
        };
    }
    if (parsed.length !== entries.length) {
        return {
            header: name,
            trusted: parsed,
            degraded: "trustedProxyCidrs partially invalid: invalid entries dropped",
        };
    }
    return { header: name, trusted: parsed, degraded: undefined };
}
/**
 * 配置期构造一次的解析器：`degraded` 打 error，运行期回退按 `warning.key` 去重打 warn，
 * 返回桶 key。去重状态属于解析器实例（插件重载即重置）。
 */
export function makeClientIpResolver(policy, logger) {
    const warned = new Set();
    if (policy.degraded !== undefined)
        logger?.error(`client ip config degraded: ${policy.degraded}`);
    return (req) => {
        const result = resolveClientIp(req, policy);
        const warning = result.warning;
        if (warning !== undefined && !warned.has(warning.key)) {
            warned.add(warning.key);
            logger?.warn(warning.message);
        }
        return result.ip;
    };
}
/**
 * 纯函数：解析本请求的客户端标识。`policy` 缺省或 `header` 为空 = 不读任何请求头（历史行为）。
 * 不写日志（告警交给 `makeClientIpResolver`），便于直接断言。
 */
export function resolveClientIp(req, policy) {
    const peer = normalizeIp(req.socket.remoteAddress);
    if (policy === undefined || policy.header === "")
        return { ip: peer, warning: undefined };
    if (peer === "" || !policy.trusted.some((network) => cidrContains(network, peer))) {
        const origin = peer === "" ? "unknown" : peer;
        return {
            ip: peer,
            warning: {
                key: "untrusted-peer",
                message: `client ip header "${policy.header}" ignored: peer ${origin} is not a trusted proxy`,
            },
        };
    }
    const value = headerValue(req, policy.header);
    const candidates = value === undefined ? [] : parseCandidates(value);
    const client = rightmostUntrusted(candidates, policy.trusted);
    if (client === undefined) {
        return {
            ip: peer,
            warning: {
                key: "header-unusable",
                message: `client ip header "${policy.header}" missing or unusable: using the socket address instead`,
            },
        };
    }
    return { ip: client, warning: undefined };
}
/** 同名头重复出现时 Node 会给数组；超长直接当不可用（回退），不截断解析。 */
function headerValue(req, name) {
    const raw = req.headers[name];
    if (raw === undefined)
        return undefined;
    const value = Array.isArray(raw) ? raw.join(",") : raw;
    return value.length > HEADER_VALUE_LIMIT ? undefined : value;
}
/** 逗号分隔 → 归一化候选（顺带容忍引号/端口装饰）；不可解析的段直接丢弃。 */
function parseCandidates(value) {
    const candidates = [];
    for (const part of value.split(",")) {
        const normalized = normalizeIp(part.trim().replace(/^"|"$/g, ""));
        if (normalized !== "")
            candidates.push(normalized);
    }
    return candidates;
}
/** 从右往左跳过受信跳，取第一个非受信地址；全是受信 → undefined（头里没有客户端信息）。 */
function rightmostUntrusted(candidates, trusted) {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index] ?? "";
        if (!trusted.some((network) => cidrContains(network, candidate)))
            return candidate;
    }
    return undefined;
}
//# sourceMappingURL=client-ip.js.map