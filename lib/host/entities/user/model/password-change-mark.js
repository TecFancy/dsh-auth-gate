/**
 * 口令变更落盘语义的唯一实现：新哈希 + `passwordChangedAt`（`users.yaml` 的
 * `password_changed_at`）。CLI `user passwd`、自助改密（`/auth/password`）与管理重置
 * 共用，避免三条路径对「何时算改过口令」给出不同答案。
 */
/** 变更时刻 → 落盘用的 ISO 串（epoch ms 或 `Date`；缺省 = 现在）。 */
export function changedAtIso(at = Date.now()) {
    return (at instanceof Date ? at : new Date(at)).toISOString();
}
/**
 * 返回改过口令的新记录（不改入参）；调用方决定是否写回快照。
 *
 * 版本必须严格单调（P2）：同一毫秒内两次改密若拿到相同 ISO 串，两次之间签发的会话会在
 * 第二次改密后继续通过版本比较。因此新时间戳至少比旧值大 1ms。
 */
export function applyPasswordChange(user, passwordHash, changedAt = Date.now()) {
    const requested = changedAt instanceof Date ? changedAt.getTime() : changedAt;
    const previous = user.passwordChangedAt === undefined ? undefined : Date.parse(user.passwordChangedAt);
    const floor = previous === undefined || Number.isNaN(previous) ? requested : previous + 1;
    return { ...user, passwordHash, passwordChangedAt: changedAtIso(Math.max(requested, floor)) };
}
