/**
 * 客户端标识解析（D19）：限速桶应该按「谁真的在登录」分桶，而不是按 TCP peer。
 *
 * 同主机反代（Caddy / Cloudflare Tunnel / nginx / Docker host 网络）下每个请求的 peer 都是
 * 回环地址，于是所有客户端塌缩成一个桶：任何一台设备错几次密码就能把整台实例锁在门外
 * （issue #74）。解法是**有条件**地信任反代写入的客户端 IP 头：
 *
 * - `header` 为空（默认）→ 一个头都不读，key = 归一化后的 `socket.remoteAddress`；
 * - `header` 非空 → **仅当** peer ∈ `trusted` 才读该头；取「从右往左数第一个合法且非受信的
 *   地址」（最左可被客户端预置，禁止）；缺失、超长、或任何一段不是合法 IP → 整头不可用，
 *   回退 peer 并告警（**不左移**：右侧出现 `unknown` 之类垃圾时，绝不能改用客户端预置的值）。
 *
 * 前提：受信代理必须**覆盖写入**该头。把客户端带来的同名头原样透传，等于把伪造权交给客户端。
 */
import type { IncomingMessage } from "node:http";
import { type CidrNetwork } from "./ip-address.js";
/** 默认只信回环：同主机反代是唯一「不用额外配置就正确」的形态。 */
export declare const DEFAULT_TRUSTED_PROXIES: readonly string[];
export interface ClientIpPolicy {
    /** 小写头名；`""` = 不读任何请求头（桶 key 恒为 socket 地址）。 */
    header: string;
    /** 受信反代网络；空数组 = 显式「谁都不信」（永不读头）。 */
    trusted: CidrNetwork[];
    /** 配置被降级的原因（非法头名 / 非法 CIDR）；`undefined` = 配置按写法生效。 */
    degraded: string | undefined;
}
export interface ClientIpWarning {
    /** 去重键：配置类问题只打一条；非受信 peer 每个地址一条，总数上限 `WARNING_LIMIT`。 */
    key: string;
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
/**
 * 解析 D19 配置。**不抛错**：非法输入退化为**更窄**的信任（非法头名 → 不读头；非法 CIDR →
 * 只信回环），原因放进 `degraded` 交给调用方打日志：配置写错绝不能让守卫卸载或放宽。
 * 前缀长度 0（`0.0.0.0/0`、`::/0`）等于「信任所有人」，一律拒绝；显式空列表表示谁都不信。
 */
export declare function parseClientIpPolicy(header: string | undefined, cidrs: readonly string[] | undefined): ClientIpPolicy;
/**
 * 配置期构造一次的解析器：`degraded` 打 error，运行期回退按 `warning.key` 去重打 warn（上限
 * `WARNING_LIMIT` 条，防伪造头刷日志），返回桶 key。去重状态属于解析器实例（插件重载即重置）。
 */
export declare function makeClientIpResolver(policy: ClientIpPolicy, logger?: ClientIpLogger): ClientIpResolver;
/**
 * 纯函数：解析本请求的客户端标识。`policy` 缺省、`header` 为空、或受信集合为空 = 不读任何请求头
 * （历史行为）。不写日志（告警交给 `makeClientIpResolver`），便于直接断言。
 */
export declare function resolveClientIp(req: IncomingMessage, policy: ClientIpPolicy | undefined): ClientIpResult;
//# sourceMappingURL=client-ip.d.ts.map