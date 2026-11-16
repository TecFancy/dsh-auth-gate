/**
 * `dsh-auth passkey` CLI 测试的共享夹具（**只被测试 import，产品代码不引用**）。
 *
 * 从 `cli.test.ts` 抽出来是因为 list 与 rm 两组用例合起来超过 250 行上限，而两边需要同一套
 * users.yaml 种子、同一组固定凭据与同一个 IO 收集器。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mutateUsersFile, type PasskeyRecord } from "../src/host/entities/user/index.js";
import type { PasskeyCliIo } from "../src/host/features/passkey/cli/cli.js";

export interface CliHarness {
  io: PasskeyCliIo;
  out: string[];
  err: string[];
}

export function makeIo(): CliHarness {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

/** 32 字节随机 handle 的 base64url 形状（同一用户在测试内复用）。 */
export const HANDLE = Buffer.alloc(32, 7).toString("base64url");
const COSE_KEY = Buffer.alloc(77, 2).toString("base64url");

/** 固定时间（UTC），让 list 的 ISO 格式成为可钉死的契约。 */
export const CREATED = Date.UTC(2025, 0, 2, 3, 4, 5); // 2025-01-02T03:04:05.000Z
export const LAST_USED = Date.UTC(2025, 1, 3, 4, 5, 6); // 2025-02-03T04:05:06.000Z

/** 三把凭据；前两把共享 12 字符前缀，用于歧义与截断断言。 */
export const CRED_A = "AAAABBBBCCCCDDDD";
export const CRED_B = "AAAABBBBCCCCEEEE";
export const CRED_C = "1111222233334444";

const AAGUID = "d548826e-79b4-db40-a3d8-11116f7e8349";

export function passkey(overrides: Partial<PasskeyRecord> = {}): PasskeyRecord {
  return {
    credentialId: CRED_A,
    publicKeyCose: COSE_KEY,
    alg: -7,
    signCount: 3,
    aaguid: AAGUID,
    be: false,
    bs: true,
    uvInitialized: true,
    transports: ["internal", "hybrid"],
    label: "MacBook Touch ID",
    createdAt: CREATED,
    lastUsedAt: LAST_USED,
    ...overrides,
  };
}

/** 临时目录 + users.yaml 路径；调用方在 `beforeEach` 里建、`afterEach` 里删。 */
export async function makeTempUsersFile(): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-passkey-cli-"));
  return { dir, file: path.join(dir, "users.yaml") };
}

/** 锁内落一份 users.yaml（0600），凭据形状由调用方固定。 */
export async function seed(file: string, name: string, passkeys: PasskeyRecord[]): Promise<void> {
  await mutateUsersFile(file, (snapshot) => {
    snapshot.users.set(name, {
      passwordHash: "scrypt$seed$hash",
      disabled: false,
      role: "user",
      mustChangePassword: false,
      passkeyUserHandle: HANDLE,
      passkeys,
    });
  });
}

/** 同一用户三把凭据：两种 transport 形状、两种 BE/BS、never 与已用时间各一。 */
export async function seedThree(file: string): Promise<void> {
  await seed(file, "alice", [
    passkey(),
    passkey({
      credentialId: CRED_B,
      label: "Phone",
      be: true,
      bs: false,
      transports: [],
      lastUsedAt: 0,
    }),
    passkey({ credentialId: CRED_C, label: "Backup", transports: ["usb"] }),
  ]);
}
