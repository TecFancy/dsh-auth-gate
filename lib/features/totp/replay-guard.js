/** 每用户最多保留的 (counter, code) 记录数（防重放评论窗口 ±2 内做清理，够用）。 */
const MAX_ENTRIES_PER_USER = 9;
/** 全局用户条目上限（防内存膨胀；超出删最早插入，与 LoginRateLimiter 同模式）。 */
const MAX_USERS = 10_000;
/**
 * TOTP 防重放守卫（M4 T7）：按用户记录最近验证通过的 (counter, code)。
 * 同一 (counter, code) 再次提交 → 拒绝（防窗口期重放）。内存态：重启清零，README 注明。
 * 只由登录端点持有；纯内存、无 IO。
 */
export class TotpReplayGuard {
    perUser = new Map();
    /**
     * 登记并判断是否重放。返回 false = 该 (counter, code) 已用过（调用方按 401 处理）；
     * true = 首次出现，已登记。登记前清理 `counter-1` 更早的记录。
     */
    checkAndRecord(username, counter, code) {
        let entries = this.perUser.get(username);
        if (entries === undefined) {
            entries = new Map();
            this.perUser.set(username, entries);
            this.pruneUsers();
        }
        for (const [existingCounter, existingCode] of entries) {
            if (existingCounter < counter - 1) {
                entries.delete(existingCounter); // 过期记录顺手清理
                continue;
            }
            if (existingCounter === counter && existingCode === code)
                return false; // 重放
        }
        entries.set(counter, code);
        while (entries.size > MAX_ENTRIES_PER_USER) {
            const oldest = [...entries.keys()].sort((a, b) => a - b)[0];
            if (oldest === undefined)
                break;
            entries.delete(oldest);
        }
        return true;
    }
    /** 用户数超上限时删除最早插入的用户（Map 迭代序 = 插入序）。 */
    pruneUsers() {
        while (this.perUser.size > MAX_USERS) {
            const oldest = this.perUser.keys().next().value;
            if (oldest === undefined)
                return;
            this.perUser.delete(oldest);
        }
    }
}
//# sourceMappingURL=replay-guard.js.map