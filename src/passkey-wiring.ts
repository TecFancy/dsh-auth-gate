import type { ServerResponse } from "node:http";
import z from "@deepseek-ai/schemastery";
import {
  CeremonyStore,
  registerPasskeyLoginEndpoints,
  resolvePasskeySettings,
  type PasskeySettings,
} from "./host/features/passkey/index.js";
import { issueLoginSession } from "./host/features/password/index.js";
import { loadUsersFile, type UserRecord } from "./host/entities/user/index.js";
import type { SessionStore } from "./host/entities/session/index.js";
import type { WrappableServer } from "./host/shared/guard/index.js";
import { makeClientIpResolver, parseClientIpPolicy } from "./host/shared/http/index.js";
import { LoginRateLimiter } from "./host/shared/rate-limit/index.js";

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
  /** 登录页 passkey 入口的渲染参数；功能不可用时 undefined。 */
  readonly login: { readonly enabled: boolean; readonly conditionalUi: boolean } | undefined;
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
    return { enabled: false, settings, login: undefined };
  }
  if (!settings.enabled) {
    if (settings.reason !== "off") {
      config.log.error(`passkey disabled: ${settings.reason}`);
    }
    return { enabled: false, settings, login: undefined };
  }
  if (settings.totpSatisfied) {
    config.log.info(
      `passkey enabled (rpId=${settings.rpId}); passkeys satisfy the TOTP two-factor policy`,
    );
  }
  return {
    enabled: true,
    settings,
    login: { enabled: true, conditionalUi: settings.conditionalUi },
  };
}

/** `makePasskeyWiring` 需要的 root 侧输入（只含端点注册与登录页渲染用到的事实）。 */
export interface PasskeyRouteWiringInput {
  readonly server: WrappableServer;
  readonly config: {
    readonly cookieName: string;
    readonly cookieSecure: boolean;
    readonly sessionTtl: number;
    readonly publicHost: string;
    readonly clientIpHeader: string;
    readonly trustedProxyCidrs: string[];
  };
  readonly auth: { readonly sessions: SessionStore | undefined };
  /** 登录成功后把浏览器送回 dsh 的 launch-token 桥（与口令登录共用）。 */
  readonly launchTokenBridge: () => Promise<string | undefined>;
  readonly usersPath: string;
  readonly settings: PasskeySettings;
  readonly log: {
    error(message: unknown): void;
    warn(message: unknown): void;
    info(message: unknown): void;
  };
}

/**
 * 注册 passkey 登录的两个端点（begin + finish）。`settings.enabled === false` 时什么都不注册，
 * 返回空 disposer：端点只在功能可用时存在，`/auth/passkey/*` 未启用时落到 `/auth` 的 404 兜底。
 *
 * 限速与口令登录**分开**：passkey 失败不会把口令登录的锁定桶打满，反之亦然。
 */
export function makePasskeyWiring(input: PasskeyRouteWiringInput): () => void {
  if (!input.settings.enabled) return () => undefined;
  const ceremony = new CeremonyStore();
  const limiter = new LoginRateLimiter();
  const policy = parseClientIpPolicy(input.config.clientIpHeader, input.config.trustedProxyCidrs);
  const clientIp = makeClientIpResolver(policy, input.log);
  const settings = input.settings;
  return registerPasskeyLoginEndpoints({
    register: (route) => input.server.register(route),
    sessions: () => input.auth.sessions,
    cookieSecure: input.config.cookieSecure,
    ceremony,
    settings: {
      rpId: settings.rpId,
      origins: settings.origins,
      enforceCounter: settings.enforceCounter,
    },
    publicHost: input.config.publicHost,
    loadUsers: () => loadUsersFile(input.usersPath),
    clientIp,
    limiter,
    issueSession: (
      res: ServerResponse,
      store: SessionStore,
      username: string,
      next: string,
      user: UserRecord,
      extraSetCookie: string[],
    ) =>
      issueLoginSession(
        {
          cookieName: input.config.cookieName,
          cookieSecure: input.config.cookieSecure,
          sessionTtl: input.config.sessionTtl,
          launchTokenBridge: input.launchTokenBridge,
          logger: input.log,
        },
        res,
        store,
        username,
        next,
        user,
        extraSetCookie,
      ),
    logger: input.log,
    now: Date.now,
  });
}
