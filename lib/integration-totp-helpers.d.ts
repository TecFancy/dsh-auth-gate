import { Context, type Fiber } from "@deepseek-ai/cordis";
export declare const TEST_PASSWORD = "s3cret-pw";
export declare function mountTotpStack(options?: {
    totp?: "off" | "optional" | "required";
    seedTotp?: boolean;
}): Promise<{
    ctx: Context;
    port: number;
    fibers: Fiber[];
    root: string;
    usersFile: string;
    totpSecret: string;
}>;
export declare function unmountStack(fibers: Fiber[], root: string): Promise<void>;
/** 当前 30s 窗口的 TOTP code（真实实现生成，供端到端流程使用）。 */
export declare function currentCode(secret: string): string;
/** POST /auth/login（带可选 cookie），返回状态 + set-cookie 数组 + 首个 cookie 对 + location。 */
export declare function postLogin(base: string, body: string, cookie?: string): Promise<{
    status: number;
    cookies: string[];
    cookie: string | undefined;
    location: string | null;
}>;
/** 从 set-cookie 数组中取指定名字的 cookie 对（名=值），供后续请求头复用。 */
export declare function cookiePair(cookies: string[], name: string): string | undefined;
//# sourceMappingURL=integration-totp-helpers.d.ts.map