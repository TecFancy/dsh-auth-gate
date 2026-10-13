export interface LoginPageOptions {
    /** 当前实例的 origin/host（反钓鱼身份块）；空串或缺省时不渲染该行。 */
    host?: string | undefined;
    /** 已通过第一段的账号名（仅 TOTP 段拿得到），渲染为 "Signing in as ..."。 */
    who?: string | undefined;
    /** 「换一个账号」回退链接（仅 TOTP 段）；服务端需在该 GET 上清掉挑战 cookie。 */
    resetHref?: string | undefined;
    /**
     * 失败页回填的用户名（D20）：未知用户 / 错口令 / 禁用三态**同样回填**，
     * 否则「只有真用户才回填」本身就是账号存在性预言机。密码字段永不回填。
     */
    username?: string | undefined;
    /**
     * 卡片顶部的「原因」提示（P1.1 / D24）。只接受服务端白名单常量（调用方负责），
     * 绝不来自请求文本：本字段一律 escapeHtml，且不改变 error/hint 槽语义。
     */
    notice?: string | undefined;
}
/** token 模式登录页：单字段（共享访问令牌），恒时校验由端点负责。 */
export declare function loginPageHtml(next: string, error?: string, options?: LoginPageOptions): string;
/** password 模式登录页（P13）：username + password 两字段，同款卡片样式。 */
export declare function passwordLoginPageHtml(next: string, error?: string, options?: LoginPageOptions): string;
/** TOTP 挑战页（M4 T6）：单验证码字段，两段式登录第二段。 */
export declare function totpChallengePageHtml(next: string, error?: string, options?: LoginPageOptions): string;
/** 登录页 URL：带 next；`stage=password` 供 TOTP 段「换一个账号」回退（服务端清挑战 cookie）。 */
export declare function loginPath(next: string, stage?: "password"): string;
//# sourceMappingURL=login-page.d.ts.map