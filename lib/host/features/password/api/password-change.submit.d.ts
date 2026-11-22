/**
 * `/auth/password` 的受理后流水线（P1 §1）：读 users → 恒时验证旧口令 → TOTP → 策略 →
 * hash → 锁内写盘 → 撤销会话 → 响应。从 `password-change.ts` 拆出，守住单文件行数上限；
 * 限速受理（admit/settle）留在入口文件，本文件只负责"每条出口结算一次"。
 */
import type { ServerResponse } from "node:http";
import type { ChangeContext, PasswordChangeDeps } from "./password-change.js";
/** 受理之后的验证与写盘；失败出口结算 failure，未结算的出口由 finally 释放占位。 */
export declare function runAdmitted(deps: PasswordChangeDeps, res: ServerResponse, ctx: ChangeContext, params: URLSearchParams, newPassword: string, code: string): Promise<void>;
