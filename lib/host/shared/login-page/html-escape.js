/**
 * 登录页所有动态文本的唯一转义入口。
 *
 * 独立小文件是为了让卡片骨架（`login-page.ts`）与 passkey 片段（`passkey-login.ts`）
 * 共用同一份转义实现，且不产生循环 import：两者都只依赖这里，谁也不依赖谁。
 */
const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};
/** HTML 文本/属性转义（五个字符）；只用于拼接进页面的动态值。 */
export function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}
//# sourceMappingURL=html-escape.js.map