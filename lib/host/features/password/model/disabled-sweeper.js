/** 默认扫描间隔（毫秒）：禁用某用户后，其已发会话最多在这么久内被吊销。 */
export const DEFAULT_REVOKE_SWEEP_MS = 5_000;
/**
 * 禁用用户会话吊销器（T13 / D8 收口）：周期扫描 users.yaml，把 `disabled: true`
 * 用户的全部会话行删掉，使 `dsh-auth user disable` 对**已在线的浏览器**也立即生效。
 *
 * 为什么是周期扫描而不是门内检查：门（`PasswordGate.decide`）按 P12 冻结为同步、
 * 零文件 IO；CLI 是独立进程，且运行中的插件在内存里持有会话表，外部改文件对它不可见。
 * 因此由插件侧轮询（读一份小 YAML）再把变更落到会话表，门保持原样。
 */
export class DisabledSessionSweeper {
    sessions;
    loadUsers;
    intervalMs;
    log;
    warnedUnreadable = false;
    warnedSweepFailure = false;
    constructor(options) {
        this.sessions = options.sessions;
        this.loadUsers = options.loadUsers;
        this.intervalMs = options.intervalMs ?? DEFAULT_REVOKE_SWEEP_MS;
        this.log = options.log;
    }
    /** 扫一遍：吊销所有禁用用户的会话，返回吊销条数。读文件失败 → 记一次警告并跳过。 */
    async sweep() {
        const store = this.sessions();
        if (store === undefined)
            return 0;
        let loaded;
        try {
            loaded = await this.loadUsers();
        }
        catch (error) {
            if (!this.warnedUnreadable) {
                this.warnedUnreadable = true;
                this.log.warn(`disabled-session sweep skipped (users file unreadable): ${error instanceof Error ? error.message : String(error)}`);
            }
            return 0;
        }
        if (loaded.missing)
            return 0;
        let revoked = 0;
        try {
            for (const [name, record] of loaded.snapshot.users) {
                if (!record.disabled)
                    continue;
                revoked += await store.revokeBySubject(name);
            }
        }
        catch (error) {
            // 插件卸载/宿主停机时 domain 已关，而定时器可能还有一个 tick 在途：
            // 这里必须吞掉，否则会变成未处理的 promise rejection（Windows CI 实测触发）。
            if (!this.warnedSweepFailure) {
                this.warnedSweepFailure = true;
                this.log.warn(`disabled-session sweep failed (session store unavailable): ${error instanceof Error ? error.message : String(error)}`);
            }
            return revoked;
        }
        if (revoked > 0) {
            this.log.info(`revoked ${revoked} session(s) of disabled user(s)`);
        }
        return revoked;
    }
    /** 启动周期扫描；返回 disposer。`intervalMs <= 0` 时不做任何事。 */
    start() {
        if (this.intervalMs <= 0)
            return () => undefined;
        const timer = setInterval(() => {
            // sweep() 自带兜底，这里再兜一层：定时器回调绝不产生未处理拒绝。
            void this.sweep().catch(() => undefined);
        }, this.intervalMs);
        timer.unref();
        return () => clearInterval(timer);
    }
}
//# sourceMappingURL=disabled-sweeper.js.map