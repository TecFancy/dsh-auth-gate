export interface SetupPageInput {
    mode: "token" | "password";
    tokenRef: string;
    cookieSecure: boolean;
    sessionTtl: number;
    usersPath: string;
    error?: string | undefined;
}
export interface SetupResultInput {
    token: string;
    /** true = 写盘成功但当前进程读不回来：重启 dsh 后它才成为唯一凭据。 */
    unreadable: boolean;
}
/** 向导页（GET，bootstrap 会话）。 */
export declare function setupPageHtml(input: SetupPageInput): string;
/** token 模式的提交结果页：新令牌只在这里出现一次。 */
export declare function setupResultHtml(input: SetupResultInput): string;
/** 已有正式会话访问向导：实例已经配置过，说明去哪儿。 */
export declare function setupConfiguredHtml(): string;
//# sourceMappingURL=setup-page.d.ts.map