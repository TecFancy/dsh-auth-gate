import type { SessionStore } from "../../../entities/session/index.js";
import type { UsersLoadResult } from "../../../entities/user/index.js";
/** 默认扫描间隔（毫秒）：禁用/改密/删号后，其已发会话最多在这么久内被吊销。 */
export declare const DEFAULT_REVOKE_SWEEP_MS = 5000;
/** 同一类告警的最小间隔（毫秒）：故障持续时每分钟一条，既可见也不刷屏。 */
export declare const WARN_INTERVAL_MS = 60000;
export interface DisabledSweeperOptions {
    /** 会话访问器（与门同形：每次现取；undefined = 会话通道不可用）。 */
    sessions: () => SessionStore | undefined;
    /** users.yaml 读取器；与登录路径共用同一份文件，避免两套真相。 */
    loadUsers: () => Promise<UsersLoadResult>;
    /** 扫描间隔（毫秒）；<= 0 = 不做周期扫描（禁用只拦新登录，= M3 旧行为）。 */
    intervalMs?: number;
    /** 告警限速用的时钟（epoch ms）；缺省 `Date.now`。 */
    now?: () => number;
    log: {
        info(message: string): void;
        warn(message: string): void;
    };
}
/**
 * 用户凭证/状态变更的会话吊销器（T13 / D8 收口）：周期扫描 users.yaml，把三类失效会话
 * 行删掉，使 CLI（独立进程，够不到会话表）改的东西对**已在线**的浏览器也生效：
 *
 * - `disabled: true` 的用户：全部会话；
 * - `password_changed_at` 已落的用户：凭证版本旧于该值的会话（旧口令认证出来的）；
 * - 已从 users.yaml 删除的用户：该 subject 的全部会话（内部 subject 除外）。
 *
 * 为什么是周期扫描而不是门内检查：门（`PasswordGate.decide`）按 P12 冻结为同步、
 * 零文件 IO；CLI 是独立进程，且运行中的插件在内存里持有会话表，外部改文件对它不可见。
 * 因此由插件侧轮询（读一份小 YAML）再把变更落到会话表，门保持原样。
 * 绝对时间规则（而不是「记住上次值」）让插件停机期间 CLI 做的改密在下次启动后也被清理。
 */
export declare class DisabledSessionSweeper {
    private readonly sessions;
    private readonly loadUsers;
    private readonly intervalMs;
    private readonly now;
    private readonly log;
    /** 每类告警上次落日志的时刻；`-Infinity` = 还没报过。 */
    private readonly warnedAt;
    constructor(options: DisabledSweeperOptions);
    /** 扫一遍并吊销失效会话，返回吊销条数；读文件/会话层失败 → 限速告警并跳过。 */
    sweep(): Promise<number>;
    /** 启动周期扫描；返回 disposer。`intervalMs <= 0` 时不做任何事。 */
    start(): () => void;
    /** 同一类告警至多每 `WARN_INTERVAL_MS` 一条：故障持续时保持安静但不永远沉默。 */
    private warn;
}
