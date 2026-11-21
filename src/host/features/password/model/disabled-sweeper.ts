import type { SessionStore } from "../../../entities/session/index.js";
import type { UserRecord, UsersLoadResult } from "../../../entities/user/index.js";

/** 默认扫描间隔（毫秒）：禁用/改密/删号后，其已发会话最多在这么久内被吊销。 */
export const DEFAULT_REVOKE_SWEEP_MS = 5_000;

/** 同一类告警的最小间隔（毫秒）：故障持续时每分钟一条，既可见也不刷屏。 */
export const WARN_INTERVAL_MS = 60_000;

/** 不是 users.yaml 用户的内部会话 subject：孤儿扫描不得吊销（`token` = token 模式的会话主体）。 */
const INTERNAL_SESSION_SUBJECTS: ReadonlySet<string> = new Set(["token"]);

export interface DisabledSweeperOptions {
  /** 会话访问器（与门同形：每次现取；undefined = 会话通道不可用）。 */
  sessions: () => SessionStore | undefined;
  /** users.yaml 读取器；与登录路径共用同一份文件，避免两套真相。 */
  loadUsers: () => Promise<UsersLoadResult>;
  /** 扫描间隔（毫秒）；<= 0 = 不做周期扫描（禁用只拦新登录，= M3 旧行为）。 */
  intervalMs?: number;
  /** 告警限速用的时钟（epoch ms）；缺省 `Date.now`。 */
  now?: () => number;
  log: { info(message: string): void; warn(message: string): void };
}

type WarnKind = "unreadable" | "sweep";

/**
 * 用户凭证/状态变更的会话吊销器（T13 / D8 收口）：周期扫描 users.yaml，把三类失效会话
 * 行删掉，使 CLI（独立进程，够不到会话表）改的东西对**已在线**的浏览器也生效：
 *
 * - `disabled: true` 的用户：全部会话；
 * - `password_changed_at` 已落的用户：`createdAt` 早于该时刻的会话（口令变更前签发）；
 * - 已从 users.yaml 删除的用户：该 subject 的全部会话（内部 subject 除外）。
 *
 * 为什么是周期扫描而不是门内检查：门（`PasswordGate.decide`）按 P12 冻结为同步、
 * 零文件 IO；CLI 是独立进程，且运行中的插件在内存里持有会话表，外部改文件对它不可见。
 * 因此由插件侧轮询（读一份小 YAML）再把变更落到会话表，门保持原样。
 * 绝对时间规则（而不是「记住上次值」）让插件停机期间 CLI 做的改密在下次启动后也被清理。
 */
export class DisabledSessionSweeper {
  private readonly sessions: () => SessionStore | undefined;
  private readonly loadUsers: () => Promise<UsersLoadResult>;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly log: DisabledSweeperOptions["log"];
  /** 每类告警上次落日志的时刻；`-Infinity` = 还没报过。 */
  private readonly warnedAt: Record<WarnKind, number> = {
    unreadable: Number.NEGATIVE_INFINITY,
    sweep: Number.NEGATIVE_INFINITY,
  };

  constructor(options: DisabledSweeperOptions) {
    this.sessions = options.sessions;
    this.loadUsers = options.loadUsers;
    this.intervalMs = options.intervalMs ?? DEFAULT_REVOKE_SWEEP_MS;
    this.now = options.now ?? Date.now;
    this.log = options.log;
  }

  /** 扫一遍并吊销失效会话，返回吊销条数；读文件/会话层失败 → 限速告警并跳过。 */
  async sweep(): Promise<number> {
    const store = this.sessions();
    if (store === undefined) return 0;
    let loaded: UsersLoadResult;
    try {
      loaded = await this.loadUsers();
    } catch (error) {
      this.warn(
        "unreadable",
        `disabled-session sweep skipped (users file unreadable): ${describe(error)}`,
      );
      return 0;
    }
    if (loaded.missing) return 0;
    try {
      const revoked = await revokeInvalidSessions(store, loaded.snapshot.users);
      if (revoked > 0) {
        this.log.info(`revoked ${revoked} session(s) of changed, disabled or removed user(s)`);
      }
      return revoked;
    } catch (error) {
      // 插件卸载/宿主停机时 domain 已关，而定时器可能还有一个 tick 在途：
      // 这里必须吞掉，否则会变成未处理的 promise rejection（Windows CI 实测触发）。
      this.warn(
        "sweep",
        `disabled-session sweep failed (session store unavailable): ${describe(error)}`,
      );
      return 0;
    }
  }

  /** 启动周期扫描；返回 disposer。`intervalMs <= 0` 时不做任何事。 */
  start(): () => void {
    if (this.intervalMs <= 0) return () => undefined;
    const timer = setInterval(() => {
      // sweep() 自带兜底，这里再兜一层：定时器回调绝不产生未处理拒绝。
      void this.sweep().catch(() => undefined);
    }, this.intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** 同一类告警至多每 `WARN_INTERVAL_MS` 一条：故障持续时保持安静但不永远沉默。 */
  private warn(kind: WarnKind, message: string): void {
    const now = this.now();
    if (now - this.warnedAt[kind] < WARN_INTERVAL_MS) return;
    this.warnedAt[kind] = now;
    this.log.warn(message);
  }
}

/** 吊销三类失效会话；单次调用内按 subject 聚合，只做全表扫描必要的次数。 */
async function revokeInvalidSessions(
  store: SessionStore,
  users: ReadonlyMap<string, UserRecord>,
): Promise<number> {
  let revoked = 0;
  for (const [name, record] of users) {
    if (record.disabled) {
      revoked += await store.revokeBySubject(name);
      continue;
    }
    const changedAt = changedAtMs(record.passwordChangedAt);
    if (changedAt !== undefined) revoked += await store.revokeBySubjectBefore(name, changedAt);
  }
  for (const subject of store.subjects()) {
    if (users.has(subject) || INTERNAL_SESSION_SUBJECTS.has(subject)) continue;
    revoked += await store.revokeBySubject(subject);
  }
  return revoked;
}

/** `password_changed_at` → epoch ms；缺失 / 不可解析 → undefined（不动该用户的会话）。 */
function changedAtMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
