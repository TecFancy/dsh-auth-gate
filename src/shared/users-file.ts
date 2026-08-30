import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify } from "yaml";
import { z } from "zod";

/** 用户名约束（P5）：字母/数字开头，可含 `._-`，总长 ≤ 64。匹配大小写敏感。 */
export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export interface UserRecord {
  passwordHash: string;
  /** M3 只解析不使用（M4 TOTP）。 */
  totpSecret?: string;
  disabled: boolean;
}

export interface UsersSnapshot {
  users: Map<string, UserRecord>;
}

/** 加载结果：`missing` 区分"文件不存在"与"存在但无用户"（warn-once，P7）。 */
export interface UsersLoadResult {
  snapshot: UsersSnapshot;
  missing: boolean;
}

/** users 文件不可用（语法/schema/权限）。message 面向操作员，可落日志。 */
export class UsersFileError extends Error {}

const userRecordSchema = z
  .object({
    passwordHash: z.string().min(1),
    totpSecret: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const usersFileSchema = z
  .object({
    version: z.literal(1),
    users: z.record(z.string(), userRecordSchema),
  })
  .strict();

/** P6：DSH_HOME env → `~/.dsh` 兜底。CLI 与插件共享。 */
export function dshHomeDir(): string {
  return process.env["DSH_HOME"] ?? path.join(os.homedir(), ".dsh");
}

/** P6：DSH_HOME env → `~/.dsh` 兜底，拼 `auth/users.yaml`。CLI 与插件共享。 */
export function defaultUsersFilePath(): string {
  return path.join(dshHomeDir(), "auth", "users.yaml");
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
    users.set(name, {
      passwordHash: record.passwordHash,
      ...(record.totpSecret === undefined ? {} : { totpSecret: record.totpSecret }),
      disabled: record.disabled ?? false,
    });
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
    };
  }
  const text = stringify({ version: 1, users });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, text, { mode: 0o600 });
  await fs.rename(`${filePath}.tmp`, filePath);
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
