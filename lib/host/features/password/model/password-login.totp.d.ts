/**
 * `POST /auth/login` 的 TOTP 挑战提交分支（M4 T6），从 `password-login.ts` 拆出守住 250 行上限。
 *
 * 这条路径**不经过密码校验**：只要手里有合法的挑战 cookie（HMAC 签名、5 分钟有效）加一个正确
 * 验证码，就能直接换会话。因此它是 passkey-only 策略必须单独拦的第二条入口 - `handlePasswordLogin`
 * 在分流之前就按 `passwordLoginDisabled` 拒绝，本文件因此只在口令可用时被调用。
 *
 * 计数走独立的 `totp` 域（P1）：口令段成功只清 `login` 域，猜码计数跨挑战保留，
 * 「重发正确口令换 4 次新机会」的循环不存在了。
 */
import type { ServerResponse } from "node:http";
import type { PasswordLoginDeps } from "./password-login.js";
/** TOTP 挑战提交：受理 → 用户文件 → 恒时验证 → 防重放 → 禁用检查 → 发会话。 */
export declare function handleTotpSubmit(deps: PasswordLoginDeps, host: string, res: ServerResponse, username: string, code: string, next: string, ip: string): Promise<void>;
