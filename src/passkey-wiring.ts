import z from "@deepseek-ai/schemastery";
import { resolvePasskeySettings, type PasskeySettings } from "./host/features/passkey/index.js";

/**
 * Passkey（通行密钥）配置片段与 root 侧装配。
 *
 * 本文件是这条功能的自包含配置边界（与 `telemetry-wiring.ts` 同性质）：`AuthConfig` 直接
 * extends `PasskeyFields`，`src/index.ts` 只留下 `...passkeyConfigFields`、一次 `wirePasskey`
 * 调用，以及把 `enabled` 透传给端点接线。
 *
 * 配置语义见 `docs/plans/passkey-login-plan_zh.md` §5.2：`publicHost` 是 RP ID/origin 的
 * 唯一锚点（绝不读请求头 `Host`）；功能配置不成立时 **fail-closed**（按 off 处理、error 日志），
 * 实例照常启动，口令 + TOTP 登录不受影响。
 */
export interface PasskeyFields {
  /**
   * 通行密钥登录开关：`"off"`（默认，出厂关闭）或 `"optional"`（用户可自行注册/使用）。
   * 仅 password 模式生效；token 模式配非 off 只记 error 并按 off 处理。
   */
  passkey: "off" | "optional";
  /** 浏览器 passkey 弹窗里的 RP 展示名（不参与校验）。 */
  passkeyRpName: string;
  /** RP ID 覆盖值；`""` = 取 `publicHost` 的 hostname（无端口、无 scheme）。 */
  passkeyRpId: string;
  /** 允许的 origin 精确白名单；`[]` = `[origin(publicHost)]`。 */
  passkeyOrigins: string[];
  /** 计数器回退且凭证为设备绑定时是否拒绝；默认 false（只 warn，尽力检测）。 */
  passkeyEnforceCounter: boolean;
  /** 登录页是否启用 passkey 自动填充（条件 UI）；默认 false，可由管理员在设置页打开。 */
  passkeyConditionalUi: boolean;
}

/** 配置片段对应的 schema 节点（展开进 `src/index.ts` 的 `Config`）。 */
export const passkeyConfigFields = {
  passkey: z.union([z.const("off"), z.const("optional")]).default("off"),
  passkeyRpName: z.string().default("DeepSeek Harness"),
  passkeyRpId: z.string().default(""),
  passkeyOrigins: z.array(z.string()).default([]),
  passkeyEnforceCounter: z.boolean().default(false),
  passkeyConditionalUi: z.boolean().default(false),
};

/** `wirePasskey` 需要的配置子集（结构兼容 `AuthConfig`；root 直接传整个 config 即可）。 */
export interface PasskeyWiringConfig extends PasskeyFields {
  mode: "token" | "password";
  publicHost: string;
  totp: "off" | "optional" | "required";
  log: {
    error(message: unknown): void;
    info(message: unknown): void;
  };
}

/** 装配结果：`enabled` 只表示「password 模式下功能可用」，`settings` 供后续端点使用。 */
export interface PasskeyWiringResult {
  readonly enabled: boolean;
  readonly settings: PasskeySettings;
}

/**
 * 解析并自检 passkey 配置：功能不成立时返回 `enabled: false` 并打 error 日志（fail-closed，
 * 实例照常启动）；`totp: "required"` 与 passkey 同开时打 info（passkey 满足 2FA，不降级）。
 */
export function wirePasskey(config: PasskeyWiringConfig): PasskeyWiringResult {
  const settings = resolvePasskeySettings({
    passkey: config.passkey,
    publicHost: config.publicHost,
    passkeyRpName: config.passkeyRpName,
    passkeyRpId: config.passkeyRpId,
    passkeyOrigins: config.passkeyOrigins,
    passkeyEnforceCounter: config.passkeyEnforceCounter,
    passkeyConditionalUi: config.passkeyConditionalUi,
    totp: config.totp,
  });
  if (config.mode !== "password") {
    if (config.passkey !== "off") {
      config.log.error("passkey is password-mode only; ignored in token mode");
    }
    return { enabled: false, settings };
  }
  if (!settings.enabled) {
    if (settings.reason !== "off") {
      config.log.error(`passkey disabled: ${settings.reason}`);
    }
    return { enabled: false, settings };
  }
  if (settings.totpSatisfied) {
    config.log.info(
      `passkey enabled (rpId=${settings.rpId}); passkeys satisfy the TOTP two-factor policy`,
    );
  }
  return { enabled: true, settings };
}
