/**
 * totp 认证增强面（M4 两段式登录的第二段：TOTP 校验 + 防重放 + CLI）。
 * password 登录流通过 deps 注入本层实现（同层互禁，见 index.ts 装配）。
 */
export * from "./totp.js";
export * from "./replay-guard.js";
export * from "./cli.js";
//# sourceMappingURL=index.js.map