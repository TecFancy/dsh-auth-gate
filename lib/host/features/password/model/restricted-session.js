/**
 * 受限会话（P2 ④）的字面量常量。**只此一处**写 `"password-change-only"`，
 * 其余模块一律 import 本文件，避免字面量漂移。
 */
export const RESTRICTED_SESSION_KIND = "password-change-only";
/**
 * 受限会话 TTL：15 分钟（CONTRACT §3），**不续期**（会话层本就没有滑动过期）。
 * 到期 = 按普通未认证处理：重新登录时标记仍在 → 再发一枚受限会话，闭环正确。
 */
export const RESTRICTED_SESSION_TTL_SECONDS = 15 * 60;
/**
 * 受限会话被拒的导航目标（§3）：改密页，**不是** `/auth/login`
 * （回登录页会渲染第二个登录表单，受限闭环会断）。
 */
export const RESTRICTED_REDIRECT_PATH = "/auth/password";
/**
 * 受限判定：**只信 `session.kind`**（§0 不变量）。
 *
 * 禁止在这里（或任何每请求路径上）读 users.yaml 的 live `must_change_password`：
 * 「清标记成功 + revoke 失败」时，旧受限 cookie 仍必须被降权，否则受限 cookie
 * 会被静默升成 full（隐式提权）。缺字段/`full` 一律按正式会话处理（旧行兼容）。
 */
export function isRestrictedSession(session) {
    return session?.kind === RESTRICTED_SESSION_KIND;
}
//# sourceMappingURL=restricted-session.js.map