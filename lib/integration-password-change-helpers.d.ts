import { Context, type Fiber } from "@deepseek-ai/cordis";
/** 旧口令（种子）与新口令（满足 ≥14 + 四类字符策略）。 */
export declare const OLD_PASSWORD = "0ld-password-Aa1!";
export declare const NEW_PASSWORD = "N3w-password-Bb2@";
/** 11 字符，四类齐但不足 14：只触发 minLength。 */
export declare const SHORT_PASSWORD = "Sh0rt-pa!s";
export interface PasswordChangeStack {
    ctx: Context;
    port: number;
    fibers: Fiber[];
    root: string;
    usersFile: string;
    base: string;
}
/** 真实 HTTP 栈：Storage(json) + WebServer(随机端口) + 插件（password 模式）。 */
export declare function mountPasswordChangeStack(options?: {
    totp?: "off" | "optional" | "required";
    totpSecret?: string;
}): Promise<PasswordChangeStack>;
export declare function unmountStack(stack: PasswordChangeStack): Promise<void>;
export declare function login(base: string, password: string): Promise<string>;
export declare function changeBody(current: string, next: string, code?: string): string;
export declare function changePassword(base: string, cookie: string, body: string, method?: string): Promise<{
    status: number;
    json: unknown;
    setCookie: string | null;
    text: string;
}>;
export declare function stillAuthenticated(base: string, cookie: string): Promise<boolean>;
export declare function storedHash(usersFile: string): Promise<string>;
//# sourceMappingURL=integration-password-change-helpers.d.ts.map