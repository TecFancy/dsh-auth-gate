import { compareNames } from "../../shared/index.js";
/**
 * 全量投影，按 `name` 字典序（复用既有 `compareNames`，显式比较器）。
 * 字段缺失不 500：`role` 缺省 `user`、`disabled` 缺省 false（loader 已补，这里再兜一层，
 * 保证键集合恒定、不出现 `undefined` 值被 JSON 丢掉）。
 */
export function projectUsers(snapshot) {
    const views = [];
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
//# sourceMappingURL=users-list.js.map