/**
 * token 模式登录页：单字段（共享访问令牌），恒时校验由端点负责。
 */
export declare function loginPageHtml(next: string, error?: string): string;
/** password 模式登录页（P13）：username + password 两字段，同款卡片样式。 */
export declare function passwordLoginPageHtml(next: string, error?: string): string;
/** TOTP 挑战页（M4 T6）：单验证码字段，两段式登录第二段。 */
export declare function totpChallengePageHtml(next: string, error?: string): string;
//# sourceMappingURL=login-page.d.ts.map