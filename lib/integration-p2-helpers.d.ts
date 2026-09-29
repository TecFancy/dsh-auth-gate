import { type Fiber } from "@deepseek-ai/cordis";
/**
 * P2 集成测试夹具：真 `apply()` + 真 HTTP 栈（与 `integration.password.test.ts` 同构）。
 *
 * 关键差异：
 * - users.yaml 里 `admin` 带 `role: "admin"`（P2 管理权限来自**每请求现读**的 yaml）；
 * - `victim` 带 `totpSecret`（用于断言重置不动目标 TOTP 字节）且初始无
 *   `must_change_password` 标记；标记只在 admin 重置后才出现；
 * - `publicHost` 显式配成 `https://dsh.example.test`（带 scheme），这样 Origin 通道
 *   在 http 直连下也可用：Origin 头与实际连接地址无关，正是"运营侧配置不可伪造"的形态。
 */
export declare const P2_PUBLIC_ORIGIN = "https://dsh.example.test";
export declare const ADMIN_PASSWORD = "Admin-pw-3cret!";
export declare const VICTIM_PASSWORD = "Victim-pw-3cret!";
/** admin 重置时给 victim 设的临时口令（重置只改哈希 + 加标记，不代用户选长期口令）。 */
export declare const VICTIM_RESET_PASSWORD = "Reset-pw-5cret!";
export declare const VICTIM_NEW_PASSWORD = "New-pw-6cret!aa";
export declare const VICTIM_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
/** actor（admin）启用 TOTP 时用的 secret（RFC 6238 测试向量那枚）。 */
export declare const ADMIN_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
/** `POST /auth/users/password` 的表单体（管理重置）。 */
export declare function resetBody(target: string, password: string): Record<string, string>;
/** `POST /auth/password` 的表单体（自助改密；`nav=1` = 无 JS 表单）。 */
export declare function changeBody(current: string, password: string, nav?: boolean): Record<string, string>;
export interface P2Stack {
    readonly base: string;
    readonly usersFile: string;
    readonly fibers: Fiber[];
    readonly root: string;
}
export interface MountP2Options {
    /** 给 actor（admin）启用 TOTP：用于"同码不能在两处各用一次"的真栈用例。 */
    readonly adminTotpSecret?: string | undefined;
}
export declare function mountP2Stack(options?: MountP2Options): Promise<P2Stack>;
export declare function unmountP2Stack(stack: P2Stack): Promise<void>;
export interface Res {
    readonly status: number;
    readonly body: string;
    readonly location: string | null;
    readonly cookie: string | undefined;
    /** 全部 set-cookie 的 `名=值`（TOTP 两段式登录需要同时取挑战 cookie 与会话 cookie）。 */
    readonly cookies: string[];
    readonly allow: string | null;
}
/** 取指定名的 cookie 对（`名=值`），供后续请求头复用。 */
export declare function cookiePair(res: Res, name: string): string | undefined;
export declare function loginBody(username: string, password: string, next?: string): string;
export declare function postLogin(base: string, body: string, options?: {
    cookie?: string | undefined;
    forwardedFor?: string | undefined;
}): Promise<Res>;
/** 已认证写请求：默认带上「运营侧配置的对外来源」，即 Origin 通道的正例。 */
export declare function postForm(base: string, path: string, body: Record<string, string>, options?: {
    cookie?: string | undefined;
    origin?: string | null | undefined;
    secFetchSite?: string | undefined;
    forwardedFor?: string | undefined;
}): Promise<Res>;
export declare function get(base: string, path: string, options?: {
    cookie?: string | undefined;
    origin?: string | undefined;
    secFetchMode?: string | undefined;
    secFetchDest?: string | undefined;
    forwardedFor?: string | undefined;
}): Promise<Res>;
/** 取 `session.kind` 现读值（集成断言用；不经过 HTTP 面）。 */
export declare function sessionKindOf(cookie: string, store: {
    getByToken(t: string): unknown;
}): string;
//# sourceMappingURL=integration-p2-helpers.d.ts.map