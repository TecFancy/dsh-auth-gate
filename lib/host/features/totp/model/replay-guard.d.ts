/**
 * TOTP 防重放守卫（M4 T7）：按用户记录最近验证通过的 (counter, code)。
 * 同一窗口（counter）再次提交 → 拒绝（防窗口期重放；同窗只有一个合法码，按 counter
 * 拒绝即可，code 仅作记录保留）。内存态：重启清零，README 注明。
 * 只由登录端点持有；纯内存、无 IO。
 */
export declare class TotpReplayGuard {
    private readonly perUser;
    /**
     * 登记并判断是否重放。返回 false = 该窗口（counter）已用过（调用方按 401 处理）；
     * true = 首次出现，已登记。登记前清理 `counter-1` 更早的记录。
     */
    checkAndRecord(username: string, counter: number, code: string): boolean;
    /** 用户数超上限时删除最早插入的用户（Map 迭代序 = 插入序）。 */
    private pruneUsers;
}
//# sourceMappingURL=replay-guard.d.ts.map