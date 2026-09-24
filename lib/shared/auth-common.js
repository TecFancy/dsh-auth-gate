/**
 * 控制符（C0 + DEL）在 `Location` 里不是洁癖，而是两个真实缺陷（2026-09-24 复审）：
 * - **开放重定向**：WHATWG URL 在解析前会剥掉全部 ASCII TAB/LF/CR，
 *   于是 `"/\t/evil.com"` 在浏览器里等价于 `"//evil.com"`，即协议相对的站外地址。
 * - **登录无法完成 302**：Node 的 `writeHead` 对 CR/LF/NUL 抛 `ERR_INVALID_CHAR`，
 *   宿主 webserver 把它兜成 400（实测），口令已校验通过却回不出重定向；TAB 反而被
 *   Node 放行，所以两类都得在源头挡。
 */
/**
 * 是否含控制符。按码点逐字符判定而不是正则：eslint 的 `no-control-regex` 会拒绝
 * `[\u0000-\u001f]`（审计侧同样用循环，见 admin/audit.ts）。
 */
function hasControlChars(value) {
    for (const char of value) {
        if (isUnsafeControl(char.codePointAt(0) ?? 0))
            return true;
    }
    return false;
}
/**
 * C0（含 TAB/LF/CR/NUL）与 DEL 会破坏 302：前者被浏览器在 URL 解析前剥掉或被 Node
 * 拒绝，后者见上。**C1（U+0080–U+009F，含 U+0085 NEL）也拒**：Node 的 Latin-1 头
 * 允许它们，但部分反向代理会把 NEL 当换行，等于给 Location 留了折叠面（review G3）。
 * 非 ASCII 可打印字符（如中文路径）照旧放行。
 */
function isUnsafeControl(code) {
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}
/**
 * `next` 校验（M8+M20）与 Location 消毒（P2 复审）共用判定：单个 `/` 开头、
 * 非 `//` 开头、不含 `\`、不含控制符。`validateNext` 另加「不是 `/auth` 或
 * `/auth/*`」（防登录后 302 回环）；否则回落 `/`。token 与 password 两个端点流共用。
 */
export function isSafeRelativeTarget(target) {
    return (target.startsWith("/") &&
        !target.startsWith("//") &&
        !target.includes("\\") &&
        !hasControlChars(target));
}
export function validateNext(next) {
    if (isSafeRelativeTarget(next) && next !== "/auth" && !next.startsWith("/auth/")) {
        return next;
    }
    return "/";
}
//# sourceMappingURL=auth-common.js.map