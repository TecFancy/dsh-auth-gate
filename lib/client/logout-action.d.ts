/**
 * 会话头部右上角的登出入口（conversation.session.header.utilities，session 作用域），
 * 纯图标。挂载时 fetch /auth/status 一次（只认 cookie），仅 authenticated:true 时
 * 渲染；登出走原生 form POST（零 JS 依赖，302 回落 / → 门禁 → 登录页）。
 */
export declare function LogoutAction(): import("react").JSX.Element | null;
//# sourceMappingURL=logout-action.d.ts.map