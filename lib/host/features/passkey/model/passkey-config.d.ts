/**
 * 从既有扁平配置派生 passkey（WebAuthn）运行参数。纯函数、无 IO、无日志：调用方
 * （root 侧装配）负责把 `enabled: false` 的 reason 记成 error 并按 off 处理（fail-closed），
 * `totpSatisfied` 只用于 info 提示，不做任何降级。
 *
 * 派生规则（任何一条不成立都返回对应的 disabled reason，绝不「尽力而为」）：
 * - `passkey === "off"` → `"off"`（优先级最高，此时不检查其它字段）。
 * - `passwordLoginDisabled = passkey === "required"`：**与 WebAuthn 参数是否成立无关**。
 *   配置写坏时功能降级为不可用，但「口令不能登录」这条策略照旧生效（issue #133 第 4 点：
 *   配置失效不得自动恢复在线口令登录）。
 * - `publicHost` trim 后为空 → `"public-host-missing"`；没有 `://` 时按 `https://` 补齐；
 *   `new URL` 解析失败、非 http(s)、带 path/query/fragment 或 userinfo → `"public-host-invalid"`。
 * - `rpId = passkeyRpId || hostname(publicHost)`（显式值 trim 后小写）。它必须是域名形状：
 *   无 scheme/端口/路径、非 IP 字面量、非空标签且每段合法；单标签只允许 `localhost`。
 *   否则 `"rp-id-invalid"`，因此「publicHost 是 IP 且未显式配 rpId」也落在这里。
 * - origins：`passkeyOrigins` 为空数组时取 `[origin(publicHost)]`，否则逐项使用显式列表
 *   （显式列表**不**自动并入 publicHost 的 origin）。每项必须是绝对 URL，scheme 为 `https:`，
 *   或 `http:` 且 hostname 恰为 `localhost`；hostname 必须等于 rpId 或以 `.` + rpId 结尾；
 *   path/query/fragment/userinfo 一并拒绝。任一不成立 → `"origin-invalid"`。
 *   输出统一为规范化后的 `URL.origin`（小写 host、去默认端口、去尾斜杠）。
 * - `totpSatisfied = totp !== "off"`：passkey 登录自带 UV，满足 TOTP 两因子策略，调用方只记 info。
 */
/** 派生 passkey 参数所需的配置子集（结构兼容 root 侧的 `AuthConfig`）。 */
export interface PasskeySettingsInput {
    /**
     * 功能开关；`"off"` 时其余字段一律不参与派生。
     *
     * `"required"` = passkey-only：口令与「口令 + TOTP」都不能建立新会话，只有通行密钥可以。
     * 它同时要求 WebAuthn 参数成立，否则实例进入「谁都进不来」的 fail-closed 状态（见
     * `passwordLoginDisabled`），而不是退回口令登录。
     */
    readonly passkey: "off" | "optional" | "required";
    /** RP ID 与 origin 的唯一锚点；绝不读请求头 `Host`。 */
    readonly publicHost: string;
    /** 浏览器 passkey 弹窗的 RP 展示名，不参与校验。 */
    readonly passkeyRpName: string;
    /** RP ID 覆盖值；`""` = 取 publicHost 的 hostname。 */
    readonly passkeyRpId: string;
    /** origin 精确白名单；`[]` = `[origin(publicHost)]`。 */
    readonly passkeyOrigins: string[];
    /** 计数器回退且凭证为设备绑定时是否拒绝；默认只 warn。 */
    readonly passkeyEnforceCounter: boolean;
    /** 登录页是否启用条件 UI（自动填充）。 */
    readonly passkeyConditionalUi: boolean;
    /** 既有 TOTP 策略；只影响 `totpSatisfied` 这个提示位。 */
    readonly totp: "off" | "optional" | "required";
}
/** 功能不可用的原因（进 error 日志的固定取值，不含配置原文）。 */
export type PasskeyDisabledReason = "off" | "public-host-missing" | "public-host-invalid" | "rp-id-invalid" | "origin-invalid";
/**
 * 派生结果：`enabled: false` 时只有 reason，调用方按 off 处理。
 *
 * `passwordLoginDisabled` 在**两个分支里都在**，因为它是策略而不是能力：`passkey: "required"`
 * 而 WebAuthn 参数不成立时，结果是 `enabled: false` + `passwordLoginDisabled: true`--功能不可用，
 * 口令也仍然关闭。调用方必须按这个字段决定口令路径，不能按 `enabled` 推断。
 */
export type PasskeySettings = {
    readonly enabled: true;
    readonly passwordLoginDisabled: boolean;
    readonly rpId: string;
    readonly rpName: string;
    /** 规范化后的精确 origin 白名单（含 publicHost 派生项或显式列表）。 */
    readonly origins: string[];
    readonly enforceCounter: boolean;
    readonly conditionalUi: boolean;
    /** `totp !== "off"`：passkey 满足既有两因子策略，仅用于 info 日志。 */
    readonly totpSatisfied: boolean;
} | {
    readonly enabled: false;
    readonly passwordLoginDisabled: boolean;
    readonly reason: PasskeyDisabledReason;
};
/**
 * 把配置派生为 WebAuthn 参数。纯函数：同一输入恒得到同一输出，不读写外部状态。
 * 失败时返回 `enabled: false` 与固定 reason，由调用方记 error 并降级为 off。
 *
 * `passwordLoginDisabled` 先于所有 WebAuthn 检查算出：它是策略，不随参数校验结果变化。
 */
export declare function resolvePasskeySettings(input: PasskeySettingsInput): PasskeySettings;
//# sourceMappingURL=passkey-config.d.ts.map