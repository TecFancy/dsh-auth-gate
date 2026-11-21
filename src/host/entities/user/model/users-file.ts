import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify } from "yaml";
import { z } from "zod";
import { dshHomeDir } from "../../../shared/lib/index.js";
import type { UserRole } from "../../../shared/protocol/index.js";
import { isCode, renameWithRetry, writeFileAtomic } from "./atomic-write.js";
import type { PasskeyRecord } from "./passkey-record.js";
import {
  passkeyFieldsSchema,
  readPasskeyFields,
  validatePasskeyStore,
  writePasskeyFields,
} from "./passkey-record.js";
import { UsersFileError, errorMessage } from "./users-file-error.js";
import { acquireLock, releaseLock } from "./users-file-lock.js";

export { errorMessage, UsersFileError };

/** 用户名约束（P5）：字母/数字开头，可含 `._-`，总长 ≤ 64。匹配大小写敏感。 */
export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
 * 预留用户名（大小写不敏感）：内部身份占用这些名字（引导会话 subject 等），
 * 新用户不得使用。已存在的历史同名用户仍可登录/改密（`loadUsersFile` 只用 `USERNAME_RE`）。
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set(["bootstrap"]);

/**
 * **新建**用户名的统一校验：格式（`USERNAME_RE`）+ 非预留名（大小写不敏感）。
 * 创建路径（CLI `user add`、引导向导建首个管理员、`mutateUsersFile` 新增记录）共用；
 * 维护已有用户的路径继续用 `USERNAME_RE`，避免把历史同名用户锁在门外。
 */
export function isValidUsername(name: string): boolean {
  return USERNAME_RE.test(name) && !RESERVED_USERNAMES.has(name.toLowerCase());
}

/** 用户角色（契约 §3.1，定义在跨半边契约 D31）：`admin` 是唯一提权档位；YAML 缺省 `user`。 */
export type { UserRole };

export interface UserRecord {
  passwordHash: string;
  /** M3 只解析不使用（M4 TOTP）。 */
  totpSecret?: string;
  disabled: boolean;
  /** P1 新增；**可选**（loader 读时补 `user`）；写盘时 `user` 不落盘。 */
  role?: UserRole;
  /** P1 新增；**可选**（loader 读时补 `false`）；YAML 键 `must_change_password`，`false` 不落盘。 */
  mustChangePassword?: boolean;
  /**
   * 最近一次口令变更的时间（ISO-8601，含毫秒）；YAML 键 `password_changed_at`。
   * **可选**：老文件没有该键。会话扫描器据此吊销 `createdAt < passwordChangedAt`
   * 的会话行，使 CLI（独立进程、够不到会话存储）改的口令也在下一轮扫描生效。
   */
  passwordChangedAt?: string;
  /** base64url（解码 16–64 字节），首次注册时生成；不得含 username/邮箱等 PII。 */
  passkeyUserHandle?: string;
  /** 该用户的通行密钥；**可选**（loader 读时补 `[]`）；写盘时空数组不落盘。 */
  passkeys?: PasskeyRecord[];
}

export interface UsersSnapshot {
  users: Map<string, UserRecord>;
}

/** 加载结果：`missing` 区分"文件不存在"与"存在但无用户"（warn-once，P7）。 */
export interface UsersLoadResult {
  snapshot: UsersSnapshot;
  missing: boolean;
}

/** `password_changed_at`：可被 `Date.parse` 解析的 ISO 时间串（写侧恒为 `toISOString()`）。 */
const passwordChangedAtSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "expected an ISO-8601 timestamp");

const userRecordSchema = z
  .object({
    passwordHash: z.string().min(1),
    totpSecret: z.string().optional(),
    disabled: z.boolean().optional(),
    role: z.enum(["user", "admin"]).optional(),
    must_change_password: z.boolean().optional(),
    password_changed_at: passwordChangedAtSchema.optional(),
    ...passkeyFieldsSchema,
  })
  .strict();

const usersFileSchema = z
  .object({
    version: z.literal(1),
    users: z.record(z.string(), userRecordSchema),
  })
  .strict();

/** P6：DSH_HOME env → `~/.dsh` 兜底，拼 `auth/users.yaml`。CLI 与插件共享。 */
export function defaultUsersFilePath(): string {
  return path.join(dshHomeDir(), "auth", "users.yaml");
}

/** schema 解析结果 → 内存记录：补缺省值；可选字段缺省时不写键（保持「不落盘」语义）。 */
function toUserRecord(record: z.infer<typeof userRecordSchema>): UserRecord {
  return {
    passwordHash: record.passwordHash,
    ...(record.totpSecret === undefined ? {} : { totpSecret: record.totpSecret }),
    disabled: record.disabled ?? false,
    role: record.role ?? "user",
    mustChangePassword: record.must_change_password ?? false,
    ...(record.password_changed_at === undefined
      ? {}
      : { passwordChangedAt: record.password_changed_at }),
    ...readPasskeyFields(record),
  };
}

/** 每次登录现读（P7）。ENOENT → `{ snapshot: 空, missing: true }`（不抛）。 */
export async function loadUsersFile(filePath: string): Promise<UsersLoadResult> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (isEnoent(error)) return { snapshot: { users: new Map() }, missing: true };
    throw new UsersFileError(`cannot stat users file: ${errorMessage(error)}`);
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new UsersFileError(`users file has insecure permissions: ${filePath}`);
  }
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new UsersFileError(`cannot read users file: ${errorMessage(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    throw new UsersFileError(`invalid users file: ${errorMessage(error)}`);
  }
  const result = usersFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new UsersFileError(`invalid users file: ${result.error.message}`);
  }
  const users = new Map<string, UserRecord>();
  for (const [name, record] of Object.entries(result.data.users)) {
    if (!USERNAME_RE.test(name)) {
      throw new UsersFileError(`invalid users file: invalid username: ${name}`);
    }
    users.set(name, toUserRecord(record));
  }
  const passkeyProblem = validatePasskeyStore(users);
  if (passkeyProblem !== undefined) {
    throw new UsersFileError(`invalid users file: ${passkeyProblem}`);
  }
  return { snapshot: { users }, missing: false };
}

/** 用户名字典序（显式比较器（eslint 要求；locale 无关））。 */
export function compareNames(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** CLI 用（P19）：全量序列化 + 同目录 `.tmp` + 原子替换 + 0600；目录自动创建。 */
export async function writeUsersFile(filePath: string, snapshot: UsersSnapshot): Promise<void> {
  const users: Record<string, unknown> = {};
  const names = [...snapshot.users.keys()].sort(compareNames);
  for (const name of names) {
    const record = snapshot.users.get(name);
    if (record === undefined) continue;
    users[name] = {
      passwordHash: record.passwordHash,
      ...(record.totpSecret === undefined ? {} : { totpSecret: record.totpSecret }),
      ...(record.disabled ? { disabled: true } : {}),
      ...(record.role === "admin" ? { role: "admin" } : {}),
      ...(record.mustChangePassword ? { must_change_password: true } : {}),
      ...(record.passwordChangedAt === undefined
        ? {}
        : { password_changed_at: record.passwordChangedAt }),
      ...writePasskeyFields(record),
    };
  }
  const text = stringify({ version: 1, users });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // 唯一 tmp + fsync(文件) + rename + fsync(目录)：见 `atomic-write.ts`。
  await writeFileAtomic(filePath, text, { mode: 0o600 });
}

/** 原子替换原语对测试暴露；实现见 `atomic-write.ts`。 */
export { renameWithRetry };

/** 锁内变更函数：就地改 snapshot（返回值原样透传）。 */
type Mutator<T> = (snapshot: UsersSnapshot) => T | Promise<T>;

/**
 * 锁内 read-modify-write（契约 §3.2）：CLI 与端点的唯一变更入口。
 * mutator 内抛错 → 原样上抛（UsersFileError 保持类型）；锁内任何失败都释放锁。
 * **mutator 内不得再次调用 mutateUsersFile**（同一 lock 文件 → 自死锁，契约 §10 A8）；
 * 需要多步变更时在同一个 mutator 里改完再返回。
 */
export async function mutateUsersFile<T>(
  filePath: string,
  mutator: (snapshot: UsersSnapshot) => T | Promise<T>,
  options?: { timeoutMs?: number; staleMs?: number; attempts?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 5_000; // 契约 §3.2-1
  const staleMs = options?.staleMs ?? 10_000; // 契约 §3.2-1
  const attempts = options?.attempts ?? 3; // 契约 §3.2-2
  const lockPath = `${filePath}.lock`;
  await fs.mkdir(path.dirname(filePath), { recursive: true }).catch((error: unknown) => {
    throw new UsersFileError(`cannot create users directory: ${errorMessage(error)}`);
  });
  const token = await acquireLock(lockPath, timeoutMs, staleMs);
  try {
    return await runMutation(filePath, mutator, attempts);
  } finally {
    await releaseLock(lockPath, token);
  }
}

/** 锁内的读 → mutator → 写前 CAS → 备份 → 原子写（契约 §3.2-2/3/4）。 */
async function runMutation<T>(filePath: string, mutator: Mutator<T>, attempts: number): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    // 指纹先于读：读之后落地的外部写入会让下面的 CAS 复核失败。
    const before = await fileStamp(filePath);
    const snapshot = (await loadUsersFile(filePath)).snapshot;
    const namesBefore = new Set(snapshot.users.keys());
    const adminsBefore = countActiveAdmins(snapshot);
    const result = await mutator(snapshot);
    // 新建记录走统一校验：格式 + 预留名（G12）；维护已有用户的路径不受影响。
    for (const name of snapshot.users.keys()) {
      if (!namesBefore.has(name) && !isValidUsername(name)) {
        throw new UsersFileError(`invalid username: ${name}`);
      }
    }
    const after = await fileStamp(filePath);
    if (before?.mtimeMs !== after?.mtimeMs || before?.size !== after?.size) {
      if (attempt >= attempts) {
        throw new UsersFileError("users file changed while it was locked; giving up");
      }
      continue;
    }
    if (adminsBefore > 0 && countActiveAdmins(snapshot) === 0) {
      throw new UsersFileError("cannot remove the last admin");
    }
    // passkey 的跨记录不变量在锁内复核（plan：上限/全局唯一/handle 存在性不能只在锁外预检）。
    const passkeyProblem = validatePasskeyStore(snapshot.users);
    if (passkeyProblem !== undefined) {
      throw new UsersFileError(`invalid users file: ${passkeyProblem}`);
    }
    await backupUsersFile(filePath);
    await writeUsersFile(filePath, snapshot);
    return result;
  }
}

/** 文件指纹（mtime + size）；不存在 → undefined（缺失是合法初态）。 */
async function fileStamp(filePath: string): Promise<{ mtimeMs: number; size: number } | undefined> {
  const stat = await fs.stat(filePath).catch((error: unknown) => {
    if (isEnoent(error)) return undefined;
    throw new UsersFileError(`cannot stat users file: ${errorMessage(error)}`);
  });
  return stat === undefined ? undefined : { mtimeMs: stat.mtimeMs, size: stat.size };
}

/** 活跃 admin 数（last-admin 不变量：`role === "admin"` 且未 disabled）。 */
function countActiveAdmins(snapshot: UsersSnapshot): number {
  return [...snapshot.users.values()].filter((u) => u.role === "admin" && !u.disabled).length;
}

/** 写前滚动备份 `.bak`（0600）；失败不阻断主写（契约 §3.2-3）。 */
async function backupUsersFile(filePath: string): Promise<void> {
  await fs.copyFile(filePath, `${filePath}.bak`).catch(() => undefined);
  await fs.chmod(`${filePath}.bak`, 0o600).catch(() => undefined);
}

function isEnoent(error: unknown): boolean {
  return isCode(error, "ENOENT");
}
