/**
 * passkey 注册/管理/设置端点的注入面（root 侧装配把配置、存储、再认证与写盘收拢成这个形状）。
 *
 * 与登录端点共用同一个 `CeremonyStore`、同一个限速器实例与同一份 `settings`；管理侧额外需要
 * 会话 cookie 名（定位已登录会话）、TOTP 模式（再认证策略）与 `management` 那一组能力。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Session, SessionStore } from "../../../entities/session/index.js";
import type { UserRecord, UsersLoadResult, UsersSnapshot } from "../../../entities/user/index.js";
import type {
  PasskeyAdminErrorBody,
  PasskeyListResponse,
  PasskeySettingsResponse,
  PasskeySummary,
} from "../../../shared/protocol/index.js";
import type { LoginRateLimiter } from "../../../shared/rate-limit/index.js";
import type { CeremonyStore } from "../model/ceremony-store.js";
import type { PasskeyLoginSettings } from "../model/passkey-login.js";

/** 管理端点需要的 WebAuthn 参数（比登录多一个 `rpName`，注册 options 的展示名）。 */
export interface PasskeyManagementSettings extends PasskeyLoginSettings {
  /** 浏览器 passkey 弹窗里的 RP 展示名；缺省回退 `"DeepSeek Harness"`。 */
  readonly rpName?: string | undefined;
}

/** 再认证与写盘能力（root 侧装配注入；features 之间不互相 import）。 */
export interface PasskeyManagement {
  /** 锁内 RMW（`mutateUsersFile(usersPath, m)`）：唯一变更通道，跨记录不变量在锁内复核。 */
  readonly mutateUsers: (
    mutator: (snapshot: UsersSnapshot) => void | Promise<void>,
  ) => Promise<void>;
  /** 当前口令校验（`verifyPassword`）。 */
  readonly verify: (password: string, storedHash: string) => Promise<boolean>;
  /** 口令哈希（当前端点不用；保留以对齐装配形状，避免 root 侧多写一层适配）。 */
  readonly hash: (password: string) => Promise<string>;
  /** TOTP 校验：命中返回 counter，失败 undefined。 */
  readonly verifyTotp: (secretB32: string, code: string, nowMs: number) => number | undefined;
  /** 与登录共用的防重放单例；false = 同窗重放。 */
  readonly replayCheck: (username: string, counter: number, code: string) => boolean;
  /** 条件 UI 的当前值（admin 设置页读）。 */
  readonly conditionalUi: () => boolean;
  /** 写回条件 UI 开关（失败只记日志，不改内存值）。 */
  readonly persistConditionalUi: (enabled: boolean) => Promise<void>;
}

/** 管理端点依赖子集（`PasskeyEndpointsDeps` 结构上满足它）。 */
export interface PasskeyManagementDeps {
  readonly sessions: () => SessionStore | undefined;
  /** 会话 cookie 名：管理端点只认 cookie（Bearer 不参与）。 */
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  readonly ceremony: CeremonyStore;
  readonly settings: PasskeyManagementSettings;
  readonly publicHost: string;
  readonly loadUsers: () => Promise<UsersLoadResult>;
  readonly clientIp: (req: IncomingMessage) => string;
  readonly limiter: LoginRateLimiter;
  /** TOTP 策略：`off` 忽略 secret；其余在用户有 secret 时要求验证码。 */
  readonly totpMode: "off" | "optional" | "required";
  readonly logger: {
    error(message: unknown): void;
    warn(message: unknown): void;
    info(message: unknown): void;
  };
  /** 时钟（epoch ms）；`createdAt` 与 TOTP 校验用。缺省 `Date.now`（测试注入固定时钟）。 */
  readonly now?: (() => number) | undefined;
  readonly management: PasskeyManagement;
}

/** 已通过会话门禁的请求上下文。 */
export interface AuthedPasskeyRequest {
  readonly session: Session;
  readonly username: string;
  readonly user: UserRecord;
  readonly snapshot: UsersSnapshot;
}

/** 会话定位结论：无 cookie / 存储不可用 / 有效会话（`kind` 由调用方判定）。 */
export type SessionLookup =
  | { readonly kind: "no-cookie" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "session"; readonly session: Session };

/** 管理端点写出的 JSON 形状（跨半边契约 D31；写错键或错误码编译不过）。 */
export type PasskeyManagementJsonBody =
  | { readonly ok: true; readonly passkey: PasskeySummary }
  | { readonly ok: true; readonly removed: number }
  | PasskeyListResponse
  | PasskeySettingsResponse
  | PasskeyAdminErrorBody;

/** 管理端点 handler 的形状（与 `HttpHandler` 同形，单独命名便于路由表声明）。 */
export type PasskeyManagementHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;
