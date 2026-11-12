import { randomBytes } from "node:crypto";

/** 仪式类别：`login` 匿名登录，`register` 已登录 + 再认证后的注册。 */
export type CeremonyKind = "login" | "register";

/**
 * 一次在途 WebAuthn 仪式的服务端记录。
 *
 * `challenge` 必须由 finish 端点重新读出并作为 `expectedChallenge` 交给校验库；
 * `id` 只写进 `dsh_auth_pk` 不透明 cookie，challenge 永远不出现在客户端。
 */
export interface CeremonyRecord {
  /** 32 字节随机数的无填充 base64url（43 字符），cookie 只携带它。 */
  readonly id: string;
  /** 32 字节 WebAuthn challenge；调用方按协议把它编码进 options 响应。 */
  readonly challenge: Uint8Array;
  readonly kind: CeremonyKind;
  /** 登录/注册绑定的用户；不绑定时为 undefined。 */
  readonly userId: string | undefined;
  /** 注册时生成或登录时查回的 `passkeyUserHandle`。 */
  readonly userHandle: string | undefined;
  /** 注册仪式里用户填的凭证显示名；登录仪式为 undefined。 */
  readonly label: string | undefined;
  /** epoch ms；`<= now` 即视为过期。 */
  readonly expiresAt: number;
}

/** `create` 的输入；可选字段显式允许 undefined，便于调用方按条件原样透传。 */
export interface CeremonyCreateOptions {
  readonly kind: CeremonyKind;
  readonly userId?: string | undefined;
  readonly userHandle?: string | undefined;
  readonly label?: string | undefined;
}

/** 构造参数：TTL、容量、时钟与随机源都可注入（测试不碰真实时间）。 */
export interface CeremonyStoreOptions {
  /** 记录存活时长，缺省 120_000ms（与 ceremony cookie 的 Max-Age=120 对齐）。 */
  readonly ttlMs?: number;
  /** 条目上限，缺省 1024；超限按插入序丢最旧。 */
  readonly maxEntries?: number;
  /** 当前时间（epoch ms），缺省 `Date.now`。 */
  readonly now?: () => number;
  /** 随机字节源，缺省 `randomBytes`；测试注入确定性输出。 */
  readonly random?: (bytes: number) => Uint8Array;
}

/** id 与 challenge 各自的随机字节数（32 字节 base64url 固定 43 字符）。 */
const RANDOM_BYTES = 32;
const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_ENTRIES = 1024;

/**
 * 进程内一次性 WebAuthn 仪式存储，与 `LoginRateLimiter` / `TotpReplayGuard` 同寿命。
 *
 * 调用方可感知的契约：
 * - **一次性**：`consume` 先删后验，同一 id 并发或重放只有第一次拿到记录，其余 undefined。
 * - **过期即无**：`expiresAt <= now` 的记录视作不存在；清理在 `create`/`consume` 内完成，
 *   不挂定时器，因此没有后台任务需要 dispose。
 * - **容量兜底**：超过 `maxEntries` 时按插入序丢最旧。它不防驱逐攻击，options 端点仍需限速。
 * - **单进程**：Map 只对单实例成立；重启或插件重载后在途仪式全部失效，用户重试一次即可。
 * - 纯内存、无 IO；记录里的字节数组由本存储持有，调用方不得原地修改。
 */
export class CeremonyStore {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly random: (bytes: number) => Uint8Array;
  /** Map 迭代序 = 插入序，容量驱逐直接取首个键。 */
  private readonly records = new Map<string, CeremonyRecord>();

  constructor(options: CeremonyStoreOptions = {}) {
    this.ttlMs = Math.max(0, Math.trunc(options.ttlMs ?? DEFAULT_TTL_MS));
    this.maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? randomBytes;
  }

  /**
   * 签发一条仪式记录：先清过期，再按容量丢最旧，最后返回新记录。
   * id 与 challenge 各自独立取 32 字节随机数（注入的随机源会被依次调用两次）。
   */
  create(options: CeremonyCreateOptions): CeremonyRecord {
    const now = this.now();
    this.prune(now);
    const record: CeremonyRecord = {
      id: encodeBase64Url(this.random(RANDOM_BYTES)),
      challenge: this.random(RANDOM_BYTES),
      kind: options.kind,
      userId: options.userId,
      userHandle: options.userHandle,
      label: options.label,
      expiresAt: now + this.ttlMs,
    };
    while (this.records.size >= this.maxEntries) {
      const oldestId = this.records.keys().next().value;
      if (oldestId === undefined) break;
      this.records.delete(oldestId);
    }
    this.records.set(record.id, record);
    return record;
  }

  /**
   * 取出并删除一条记录（先删后验：并发 consume 同一 id 只有一个成功）。
   * 空 id、未知 id、已过期都返回 undefined；返回的记录之后不会再被读出。
   */
  consume(id: string): CeremonyRecord | undefined {
    if (id === "") return undefined;
    const now = this.now();
    const record = this.records.get(id);
    if (record !== undefined) this.records.delete(id);
    this.prune(now);
    if (record === undefined || record.expiresAt <= now) return undefined;
    return record;
  }

  /** 删除全部过期记录（`expiresAt <= now`）。 */
  private prune(now: number): void {
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(id);
    }
  }
}

/** `Uint8Array` → 无填充 base64url（32 字节固定 43 字符）。 */
function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
