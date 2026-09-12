import type { SessionStore } from "../../session/index.js";
import type { UsersLoadResult } from "../../shared/index.js";
/** 默认扫描间隔（毫秒）：禁用某用户后，其已发会话最多在这么久内被吊销。 */
export declare const DEFAULT_REVOKE_SWEEP_MS = 5000;
export interface DisabledSweeperOptions {
    /** 会话访问器（与门同形：每次现取；undefined = 会话通道不可用）。 */
    sessions: () => SessionStore | undefined;
    /** users.yaml 读取器；与登录路径共用同一份文件，避免两套真相。 */
    loadUsers: () => Promise<UsersLoadResult>;
    /** 扫描间隔（毫秒）；<= 0 = 不做周期扫描（禁用只拦新登录，= M3 旧行为）。 */
    intervalMs?: number;
    log: {
        info(message: string): void;
        warn(message: string): void;
    };
}
/**
 * 禁用用户会话吊销器（T13 / D8 收口）：周期扫描 users.yaml，把 `disabled: true`
 * 用户的全部会话行删掉，使 `dsh-auth user disable` 对**已在线的浏览器**也立即生效。
 *
 * 为什么是周期扫描而不是门内检查：门（`PasswordGate.decide`）按 P12 冻结为同步、
 * 零文件 IO；CLI 是独立进程，且运行中的插件在内存里持有会话表，外部改文件对它不可见。
 * 因此由插件侧轮询（读一份小 YAML）再把变更落到会话表，门保持原样。
 */
export declare class DisabledSessionSweeper {
    private readonly sessions;
    private readonly loadUsers;
    private readonly intervalMs;
    private readonly log;
    private warnedUnreadable;
    constructor(options: DisabledSweeperOptions);
    /** 扫一遍：吊销所有禁用用户的会话，返回吊销条数。读文件失败 → 记一次警告并跳过。 */
    sweep(): Promise<number>;
    /** 启动周期扫描；返回 disposer。`intervalMs <= 0` 时不做任何事。 */
    start(): () => void;
}
//# sourceMappingURL=disabled-sweeper.d.ts.map