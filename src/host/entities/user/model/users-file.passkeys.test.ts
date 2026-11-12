import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PasskeyRecord, UserRecord } from "../index.js";
import { loadUsersFile, mutateUsersFile, UsersFileError, writeUsersFile } from "./users-file.js";

/** 32 字节随机 handle 的 base64url 形状（固定字节便于断言）。 */
const HANDLE = Buffer.alloc(32, 7).toString("base64url");
const CREDENTIAL_ID = Buffer.alloc(16, 1).toString("base64url");
const COSE_KEY = Buffer.alloc(77, 2).toString("base64url");
const AAGUID = "d548826e-79b4-db40-a3d8-11116f7e8349";

/** 无 passkey 字段的旧文件（既有 writer 的逐字输出形状）。 */
const LEGACY_YAML = `version: 1
users:
  alice:
    passwordHash: scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k
    disabled: true
`;

/** 合法凭据（字段顺序与写入顺序一致）。 */
function passkey(overrides: Partial<PasskeyRecord> = {}): PasskeyRecord {
  return {
    credentialId: CREDENTIAL_ID,
    publicKeyCose: COSE_KEY,
    alg: -7,
    signCount: 3,
    aaguid: AAGUID,
    be: false,
    bs: false,
    uvInitialized: true,
    transports: ["internal", "hybrid"],
    label: "MacBook Touch ID",
    createdAt: 1_762_800_000_000,
    lastUsedAt: 0,
    ...overrides,
  };
}

/** 故意构造非法凭据：writer 不校验，形状检查在这里绕过。 */
function badPasskey(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...passkey(), ...overrides };
}

/** 单用户的存储形状；`handle === null` 表示不写 `passkeyUserHandle` 键。 */
function store(handle: string | null, passkeys: unknown[]): Record<string, unknown> {
  return {
    alice: {
      passwordHash: "a",
      ...(handle === null ? {} : { passkeyUserHandle: handle }),
      passkeys,
    },
  };
}

/** base64url 编码的 n 字节（用于边界长度用例）。 */
function bytes(count: number, fill: number): string {
  return Buffer.alloc(count, fill).toString("base64url");
}

/** 写盘用例的输入：默认值显式写全（`role`/`mustChangePassword` 不落盘）。 */
const ALICE_WITH_PASSKEY: UserRecord = {
  passwordHash: "h",
  disabled: false,
  role: "user",
  mustChangePassword: false,
  passkeyUserHandle: HANDLE,
  passkeys: [passkey()],
};

/** writer 的逐字期望输出：固定键序，`false` 与 `0` 显式。 */
const ALICE_WITH_PASSKEY_YAML = `version: 1
users:
  alice:
    passwordHash: h
    passkeyUserHandle: ${HANDLE}
    passkeys:
      - credentialId: ${CREDENTIAL_ID}
        publicKeyCose: ${COSE_KEY}
        alg: -7
        signCount: 3
        aaguid: ${AAGUID}
        be: false
        bs: false
        uvInitialized: true
        transports:
          - internal
          - hybrid
        label: MacBook Touch ID
        createdAt: 1762800000000
        lastUsedAt: 0
`;

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-passkeys-"));
  file = path.join(dir, "users.yaml");
  await fs.writeFile(file, LEGACY_YAML, { mode: 0o600 });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** 直接把对象写成 users.yaml（loader 的权限检查要求 0600，文件已由 beforeEach 建好）。 */
async function writeYaml(users: Record<string, unknown>): Promise<void> {
  await fs.writeFile(file, stringify({ version: 1, users }));
}

describe("loadUsersFile passkeys", () => {
  it("defaults passkeys to [] and leaves passkeyUserHandle undefined", async () => {
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.passkeys).toEqual([]);
    expect(snapshot.users.get("alice")?.passkeyUserHandle).toBeUndefined();
  });

  it("reads passkeyUserHandle and passkeys, deduping transports", async () => {
    await writeYaml({
      alice: {
        passwordHash: "a",
        passkeyUserHandle: HANDLE,
        passkeys: [passkey({ alg: -8, transports: ["internal", "internal", "hybrid"] })],
      },
    });
    const loaded = (await loadUsersFile(file)).snapshot.users.get("alice");
    expect(loaded?.passkeyUserHandle).toBe(HANDLE);
    expect(loaded?.passkeys).toEqual([passkey({ alg: -8 })]);
  });

  it("accepts a handle without any registered passkey", async () => {
    await writeYaml({ alice: { passwordHash: "a", passkeyUserHandle: HANDLE } });
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.passkeys).toEqual([]);
  });

  it("keeps an empty transports list and lastUsedAt 0", async () => {
    await writeYaml(store(HANDLE, [passkey({ alg: -257, transports: [], lastUsedAt: 0 })]));
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.passkeys).toEqual([
      passkey({ alg: -257, transports: [] }),
    ]);
  });
});

/** 每条都是「写进 YAML 后 loader 必须拒绝」。 */
const DOUBTFUL: [string, Record<string, unknown>][] = [
  [
    "more than 10 passkeys",
    store(
      HANDLE,
      Array.from({ length: 11 }, (_, index) => passkey({ credentialId: bytes(16, index) })),
    ),
  ],
  [
    "duplicate credentialId across users",
    {
      alice: { passwordHash: "a", passkeyUserHandle: HANDLE, passkeys: [passkey()] },
      bob: { passwordHash: "b", passkeyUserHandle: HANDLE, passkeys: [passkey()] },
    },
  ],
  ["duplicate credentialId in one user", store(HANDLE, [passkey(), passkey()])],
  ["passkeys without passkeyUserHandle", store(null, [passkey()])],
  ["passkeyUserHandle too short", store(bytes(8, 1), [passkey()])],
  ["passkeyUserHandle too long", store(bytes(65, 1), [passkey()])],
  ["passkeyUserHandle not base64url", store("not base64url!", [passkey()])],
  ["passkeyUserHandle padded", store(`${bytes(32, 1)}=`, [passkey()])],
  ["credentialId over 1023 bytes", store(HANDLE, [passkey({ credentialId: bytes(1024, 1) })])],
  ["credentialId not base64url", store(HANDLE, [passkey({ credentialId: "not/base64+url" })])],
  ["credentialId empty", store(HANDLE, [passkey({ credentialId: "" })])],
  ["publicKeyCose over 1024 bytes", store(HANDLE, [passkey({ publicKeyCose: bytes(1025, 1) })])],
  ["publicKeyCose empty", store(HANDLE, [passkey({ publicKeyCose: "" })])],
  ["alg outside -7/-257/-8", store(HANDLE, [badPasskey({ alg: 0 })])],
  ["signCount negative", store(HANDLE, [badPasskey({ signCount: -1 })])],
  ["signCount fractional", store(HANDLE, [badPasskey({ signCount: 1.5 })])],
  ["signCount over uint32", store(HANDLE, [badPasskey({ signCount: 4_294_967_296 })])],
  ["aaguid not a uuid", store(HANDLE, [badPasskey({ aaguid: "not-a-uuid" })])],
  ["transports outside the allowlist", store(HANDLE, [badPasskey({ transports: ["sata"] })])],
  ["transports not an array", store(HANDLE, [badPasskey({ transports: "internal" })])],
  ["label empty", store(HANDLE, [passkey({ label: "" })])],
  ["label over 64 characters", store(HANDLE, [passkey({ label: "a".repeat(65) })])],
  ["label with a control character", store(HANDLE, [passkey({ label: "bad\u0000label" })])],
  ["unknown key in a passkey record", store(HANDLE, [badPasskey({ extra: "x" })])],
  ["missing be flag", store(HANDLE, [badPasskey({ be: undefined })])],
  ["createdAt negative", store(HANDLE, [badPasskey({ createdAt: -1 })])],
  ["lastUsedAt fractional", store(HANDLE, [badPasskey({ lastUsedAt: 0.5 })])],
  [
    "passkeys not an array",
    { alice: { passwordHash: "a", passkeyUserHandle: HANDLE, passkeys: passkey() } },
  ],
];

describe("loadUsersFile passkey rejections", () => {
  it("rejects every invalid store as a UsersFileError", async () => {
    for (const [name, users] of DOUBTFUL) {
      await writeYaml(users);
      const failure = loadUsersFile(file);
      await expect(failure, name).rejects.toBeInstanceOf(UsersFileError);
      await expect(failure, name).rejects.toThrow(/^invalid users file: /);
    }
  });
});

describe("writeUsersFile passkeys", () => {
  let target: string;

  beforeEach(() => {
    target = path.join(dir, "sub", "users.yaml");
  });

  it("writes fixed key order, explicit false flags and explicit zero", async () => {
    await writeUsersFile(target, { users: new Map([["alice", ALICE_WITH_PASSKEY]]) });
    expect(await fs.readFile(target, "utf8")).toBe(ALICE_WITH_PASSKEY_YAML);
  });

  it("omits empty passkeys but keeps the handle", async () => {
    await writeUsersFile(target, {
      users: new Map([
        ["alice", { passwordHash: "h", disabled: false, passkeyUserHandle: HANDLE, passkeys: [] }],
      ]),
    });
    const text = await fs.readFile(target, "utf8");
    expect(text).not.toContain("passkeys");
    expect(text).toContain(`passkeyUserHandle: ${HANDLE}`);
  });

  it("keeps the legacy fixture byte-identical on rewrite", async () => {
    const { snapshot } = await loadUsersFile(file);
    await writeUsersFile(target, snapshot);
    expect(await fs.readFile(target, "utf8")).toBe(LEGACY_YAML);
  });

  it("round-trips a passkey store without byte drift", async () => {
    await writeUsersFile(target, {
      users: new Map([
        [
          "alice",
          { passwordHash: "h", disabled: false, passkeyUserHandle: HANDLE, passkeys: [passkey()] },
        ],
        ["bob", { passwordHash: "h2", disabled: true }],
      ]),
    });
    const first = await fs.readFile(target, "utf8");
    const { snapshot } = await loadUsersFile(target);
    await writeUsersFile(target, snapshot);
    expect(await fs.readFile(target, "utf8")).toBe(first);
  });

  it("persists passkeys added through mutateUsersFile", async () => {
    await mutateUsersFile(file, (snapshot) => {
      const alice = snapshot.users.get("alice");
      if (alice === undefined) throw new Error("missing alice");
      alice.passkeyUserHandle = HANDLE;
      alice.passkeys = [passkey({ transports: ["internal", "internal"] })];
    });
    const loaded = (await loadUsersFile(file)).snapshot.users.get("alice");
    expect(loaded?.passkeyUserHandle).toBe(HANDLE);
    expect(loaded?.passkeys).toEqual([passkey({ transports: ["internal"] })]);
  });
});

describe("mutateUsersFile passkey guards", () => {
  it("rejects a mutation that duplicates a credentialId and leaves the file untouched", async () => {
    const before = await fs.readFile(file, "utf8");
    await expect(
      mutateUsersFile(file, (snapshot) => {
        snapshot.users.set("bob", {
          passwordHash: "b",
          disabled: false,
          passkeyUserHandle: HANDLE,
          passkeys: [passkey()],
        });
        const alice = snapshot.users.get("alice");
        if (alice === undefined) throw new Error("missing alice");
        alice.passkeyUserHandle = HANDLE;
        alice.passkeys = [passkey()];
      }),
    ).rejects.toBeInstanceOf(UsersFileError);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
});
