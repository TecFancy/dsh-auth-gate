/**
 * 禁止本实例被跨源 iframe 当作 WebAuthn 中继（plan §5.2）：登录页与全部 `/auth` 响应
 * 统一下发该值。
 *
 * **必须是 `=(self)`，不能是 `=()`**：`=()` 表示「任何文档都不允许」，连顶层文档自己也会被
 * 禁掉，`navigator.credentials.get/create` 直接抛 `NotAllowedError`（2026-11-12 在隔离实例里
 * 实测到，登录页的 passkey 按钮因此永远失败）。`=(self)` 只允许同源文档，跨源 iframe 仍然
 * 拿不到这两个能力，正是我们要的效果。
 */
export const PASSKEY_PERMISSIONS_POLICY = "publickey-credentials-get=(self), publickey-credentials-create=(self)";
/** 在响应头阶段下发 `Permissions-Policy`；必须在 `writeHead` 之前调用。 */
export function setPasskeyPermissionsPolicy(res) {
    res.setHeader("permissions-policy", PASSKEY_PERMISSIONS_POLICY);
}
//# sourceMappingURL=permissions-policy.js.map