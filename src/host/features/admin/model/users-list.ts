import { compareNames } from "../../../entities/user/index.js";
import type { UsersSnapshot } from "../../../entities/user/index.js";
import type { AdminUserRow } from "../../../shared/protocol/index.js";

/**
 * 管理列表投影（§1）：行形状是跨半边契约的 `AdminUserRow`（D31），只含「关于用户」的公开字段。
 * 全量投影，按 `name` 字典序（复用既有 `compareNames`，显式比较器）。
 * 字段缺失不 500：`role` 缺省 `user`、`disabled` 缺省 false（loader 已补，这里再兜一层，
 * 保证键集合恒定、不出现 `undefined` 值被 JSON 丢掉）。
 */
export function projectUsers(snapshot: UsersSnapshot): AdminUserRow[] {
  const views: AdminUserRow[] = [];
  for (const [name, record] of snapshot.users) {
    views.push({
      name,
      role: record.role === "admin" ? "admin" : "user",
      disabled: record.disabled === true,
      totpEnabled: record.totpSecret !== undefined,
      mustChangePassword: record.mustChangePassword === true,
    });
  }
  views.sort((a, b) => compareNames(a.name, b.name));
  return views;
}
