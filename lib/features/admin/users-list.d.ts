import type { UserRole, UsersSnapshot } from "../../shared/index.js";
/**
 * 管理列表投影（§1）：只含「关于用户」的公开字段。
 * 绝不含哈希 / 盐 / scrypt 参数 / `totpSecret` / 会话数 / 最近登录时间。
 */
export interface AdminUserView {
    name: string;
    role: UserRole;
    disabled: boolean;
    totpEnabled: boolean;
    mustChangePassword: boolean;
}
/**
 * 全量投影，按 `name` 字典序（复用既有 `compareNames`，显式比较器）。
 * 字段缺失不 500：`role` 缺省 `user`、`disabled` 缺省 false（loader 已补，这里再兜一层，
 * 保证键集合恒定、不出现 `undefined` 值被 JSON 丢掉）。
 */
export declare function projectUsers(snapshot: UsersSnapshot): AdminUserView[];
//# sourceMappingURL=users-list.d.ts.map