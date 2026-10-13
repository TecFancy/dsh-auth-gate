/**
 * IP 字面量解析 / 归一化 / CIDR 匹配（D19 客户端标识的底座；纯函数，叶子层）。
 *
 * 为什么必须归一化：限速桶 key 是字符串，同一客户端的不同写法会裂成多个桶
 * （`::ffff:1.2.3.4` 与 `1.2.3.4`、`2001:0DB8::1` 与 `2001:db8::1`），受信反代判定
 * 也会因为写法不同而失灵。本模块不读请求、不写日志、不碰配置。
 */
import { isIP } from "node:net";
/** 去 `[...]`、`host:port`、`%zone` 装饰；其余原样返回，交给后面的字面量校验。 */
function stripDecorations(raw) {
    const text = raw.trim();
    const bracketed = /^\[([^\]]*)\](?::\d+)?$/.exec(text);
    if (bracketed !== null)
        return (bracketed[1] ?? "").split("%")[0] ?? "";
    if (isIP(text) === 0) {
        const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text);
        if (withPort !== null)
            return withPort[1] ?? "";
    }
    return text.split("%")[0] ?? "";
}
/** 严格点分四段（拒绝前导零与 >255）。 */
function ipv4ToBytes(address) {
    const parts = address.split(".");
    if (parts.length !== 4)
        return undefined;
    const bytes = [];
    for (const part of parts) {
        if (!/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(part))
            return undefined;
        bytes.push(Number(part));
    }
    return bytes;
}
/** 单段十六进制组（1-4 位）。 */
function groupsOf(part) {
    if (part === "")
        return [];
    const groups = [];
    for (const group of part.split(":")) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group))
            return undefined;
        groups.push(Number.parseInt(group, 16));
    }
    return groups;
}
/** `::ffff:1.2.3.4` 末尾的内嵌 IPv4 折成两个十六进制组；非法点分四段 → undefined。 */
function expandEmbeddedIpv4(body) {
    const embedded = /((?:\d{1,3}\.){3}\d{1,3})$/.exec(body);
    if (embedded === null)
        return body;
    const quad = ipv4ToBytes(embedded[1] ?? "");
    if (quad === undefined)
        return undefined;
    const high = ((quad[0] ?? 0) << 8) | (quad[1] ?? 0);
    const low = ((quad[2] ?? 0) << 8) | (quad[3] ?? 0);
    return `${body.slice(0, embedded.index)}${high.toString(16)}:${low.toString(16)}`;
}
/** 展开 IPv6（含末尾内嵌 IPv4）→ 8 个 16 位组；非法 → undefined。 */
function ipv6Groups(address) {
    const body = expandEmbeddedIpv4(address);
    if (body === undefined)
        return undefined;
    const halves = body.split("::");
    if (halves.length > 2)
        return undefined;
    const head = groupsOf(halves[0] ?? "");
    const tail = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
    if (head === undefined || tail === undefined)
        return undefined;
    if (halves.length === 1)
        return head.length === 8 ? head : undefined;
    const missing = 8 - head.length - tail.length;
    if (missing < 1)
        return undefined;
    return [...head, ...new Array(missing).fill(0), ...tail];
}
/** RFC 5952：最长零串（≥2 组）压成 `::`，小写、无前导零。 */
function formatGroups(groups) {
    let bestStart = -1;
    let bestLength = 0;
    let start = -1;
    for (let index = 0; index <= groups.length; index += 1) {
        const isZero = index < groups.length && groups[index] === 0;
        if (isZero && start === -1)
            start = index;
        if (!isZero && start !== -1) {
            const length = index - start;
            if (length > bestLength) {
                bestStart = start;
                bestLength = length;
            }
            start = -1;
        }
    }
    const hex = groups.map((group) => group.toString(16));
    if (bestLength < 2)
        return hex.join(":");
    return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}
/** 16 字节 → 文本；IPv4-mapped（`::ffff:a.b.c.d`）折成点分四段，与 v4 同 key。 */
function bytesToAddress(bytes) {
    if (bytes.length === 4)
        return bytes.join(".");
    const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
    if (mapped)
        return bytes.slice(12).join(".");
    const groups = [];
    for (let index = 0; index < 16; index += 2) {
        groups.push(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
    }
    return formatGroups(groups);
}
function addressToBytes(address) {
    if (address === "")
        return undefined;
    if (isIP(address) === 4)
        return ipv4ToBytes(address);
    const groups = ipv6Groups(address);
    if (groups === undefined)
        return undefined;
    return groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
}
/**
 * 归一化 IP 字面量：去装饰、小写、IPv4-mapped 折成点分四段、IPv6 压成 RFC 5952 形式。
 * 非 IP（`""`、`"unknown"`、超长垃圾）→ `""`，调用方据此回退，绝不把垃圾当桶 key。
 */
export function normalizeIp(raw) {
    const text = stripDecorations(raw ?? "");
    if (text === "")
        return "";
    if (isIP(text) === 4) {
        const bytes = ipv4ToBytes(text);
        return bytes === undefined ? "" : bytes.join(".");
    }
    if (isIP(text) !== 6)
        return "";
    const bytes = addressToBytes(text);
    return bytes === undefined ? "" : bytesToAddress(bytes);
}
/** `a.b.c.d/n`、`[v6]/n` → CidrNetwork；非 CIDR / 非法地址 / 前缀越界 → undefined。 */
export function parseCidr(raw) {
    const text = (raw ?? "").trim();
    const slash = text.lastIndexOf("/");
    if (slash === -1)
        return undefined;
    const address = normalizeIp(text.slice(0, slash));
    if (address === "")
        return undefined;
    const prefixText = text.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixText))
        return undefined;
    const bytes = addressToBytes(address);
    if (bytes === undefined)
        return undefined;
    const prefix = Number(prefixText);
    return prefix > bytes.length * 8 ? undefined : { bytes, prefix };
}
/** `address` 是否落在 `network` 内（地址族不同直接 false；`address` 先归一化）。 */
export function cidrContains(network, address) {
    const bytes = addressToBytes(normalizeIp(address));
    if (bytes === undefined)
        return false;
    if (bytes.length !== network.bytes.length)
        return false;
    const wholeBytes = Math.floor(network.prefix / 8);
    for (let index = 0; index < wholeBytes; index += 1) {
        if (bytes[index] !== network.bytes[index])
            return false;
    }
    const rest = network.prefix % 8;
    if (rest === 0)
        return true;
    const mask = (0xff << (8 - rest)) & 0xff;
    return ((bytes[wholeBytes] ?? 0) & mask) === ((network.bytes[wholeBytes] ?? 0) & mask);
}
//# sourceMappingURL=ip-address.js.map