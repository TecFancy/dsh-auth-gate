/**
 * 口令变更落盘语义的唯一实现：新哈希 + `passwordChangedAt`（`users.yaml` 的
 * `password_changed_at`）。CLI `user passwd`、自助改密（`/auth/password`）与管理重置
 * 共用，避免三条路径对「何时算改过口令」给出不同答案。
 */
/** 变更时刻 → 落盘用的 ISO 串（epoch ms 或 `Date`；缺省 = 现在）。 */
export function changedAtIso(at = Date.now()) {
    return (at instanceof Date ? at : new Date(at)).toISOString();
}
/** 返回改过口令的新记录（不改入参）；调用方决定是否写回快照。 */
export function applyPasswordChange(user, passwordHash, changedAt = Date.now()) {
    return { ...user, passwordHash, passwordChangedAt: changedAtIso(changedAt) };
}
