/**
 * 客户端标识解析（D19）：限速桶应该按「谁真的在登录」分桶，而不是按 TCP peer。
 *
 * 同主机反代（Caddy / Cloudflare Tunnel / nginx / Docker host 网络）下每个请求的 peer 都是
 * 回环地址，于是所有客户端塌缩成一个桶：任何一台设备错几次密码就能把整台实例锁在门外
 * （issue #74）。解法是**有条件**地信任反代写入的客户端 IP 头：
 *
 * - `header` 为空（默认）→ 一个头都不读，key = 归一化后的 `socket.remoteAddress`；
 * - `header` 非空 → **仅当** peer ∈ `trusted` 才读该头；取「从右往左跳过受信跳后的第一个
 *   合法 IP」（最左可被客户端预置，禁止）；缺失/不可解析 → 回退 peer 并告警。
 *
 * 前提：受信代理必须**覆盖写入**该头。把客户端带来的同名头原样透传，等于把伪造权交给客户端。
 */
import type { IncomingMessage } from "node:http";
import { cidrContains, normalizeIp, parseCidr, type CidrNetwork } from "./ip-address.js";

/** 请求头值长度上限：单个 IP 足够、XFF 短链也够；超长一律回退，不给解析器喂垃圾。 */
const HEADER_VALUE_LIMIT = 256;
/** 默认只信回环：同主机反代是唯一「不用额外配置就正确」的形态。 */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ["127.0.0.0/8", "::1/128"];

export interface ClientIpPolicy {
  /** 小写头名；`""` = 不读任何请求头（桶 key 恒为 socket 地址）。 */
  header: string;
  /** 受信反代网络。 */
  trusted: CidrNetwork[];
  /** 配置被降级的原因（非法头名 / 非法 CIDR）；`undefined` = 配置按写法生效。 */
  degraded: string | undefined;
}

export interface ClientIpWarning {
  /** 去重键：每类问题只打一条日志（插件实例内一次）。 */
  key: "untrusted-peer" | "header-unusable";
  message: string;
}

export interface ClientIpResult {
  /** 桶 key（归一化后）。 */
  ip: string;
  /** 回退/忽略的原因；正常取到客户端地址 → `undefined`。 */
  warning: ClientIpWarning | undefined;
}

export interface ClientIpLogger {
  error(message: string): void;
  warn(message: string): void;
}

export type ClientIpResolver = (req: IncomingMessage) => string;

function loopback(): CidrNetwork[] {
  return DEFAULT_TRUSTED_PROXIES.map((entry) => parseCidr(entry)).filter(
    (network): network is CidrNetwork => network !== undefined,
  );
}

/**
 * 解析 D19 配置。**不抛错**：非法输入退化为**更窄**的信任（非法头名 → 不读头；非法 CIDR →
 * 只信回环），原因放进 `degraded` 交给调用方打日志：配置写错绝不能让守卫卸载或放宽。
 * 前缀长度 0（`0.0.0.0/0`、`::/0`）等于「信任所有人」，一律拒绝。
 */
export function parseClientIpPolicy(
  header: string | undefined,
  cidrs: readonly string[] | undefined,
): ClientIpPolicy {
  const name = (header ?? "").trim().toLowerCase();
  if (name === "") return { header: "", trusted: loopback(), degraded: undefined };
  if (!/^[a-z0-9-]{1,64}$/.test(name)) {
    return { header: "", trusted: loopback(), degraded: `invalid clientIpHeader "${name}"` };
  }
  const entries = cidrs ?? [];
  const parsed: CidrNetwork[] = [];
  for (const entry of entries) {
    const network = parseCidr(entry);
    if (network !== undefined && network.prefix > 0) parsed.push(network);
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
export function makeClientIpResolver(
  policy: ClientIpPolicy,
  logger?: ClientIpLogger,
): ClientIpResolver {
  const warned = new Set<string>();
  if (policy.degraded !== undefined) logger?.error(`client ip config degraded: ${policy.degraded}`);
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
export function resolveClientIp(
  req: IncomingMessage,
  policy: ClientIpPolicy | undefined,
): ClientIpResult {
  const peer = normalizeIp(req.socket.remoteAddress);
  if (policy === undefined || policy.header === "") return { ip: peer, warning: undefined };
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
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  return value.length > HEADER_VALUE_LIMIT ? undefined : value;
}

/** 逗号分隔 → 归一化候选（顺带容忍引号/端口装饰）；不可解析的段直接丢弃。 */
function parseCandidates(value: string): string[] {
  const candidates: string[] = [];
  for (const part of value.split(",")) {
    const normalized = normalizeIp(part.trim().replace(/^"|"$/g, ""));
    if (normalized !== "") candidates.push(normalized);
  }
  return candidates;
}

/** 从右往左跳过受信跳，取第一个非受信地址；全是受信 → undefined（头里没有客户端信息）。 */
function rightmostUntrusted(candidates: string[], trusted: CidrNetwork[]): string | undefined {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index] ?? "";
    if (!trusted.some((network) => cidrContains(network, candidate))) return candidate;
  }
  return undefined;
}
