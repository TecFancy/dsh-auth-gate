import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isValidUsername,
  loadUsersFile,
  mutateUsersFile,
  UsersFileError,
  writeUsersFile,
  type UserRecord,
} from "./users-file.js";

/** 满足既有 schema 的最小记录（role/mustChangePassword 显式缺省）。 */
function user(passwordHash: string): UserRecord {
  return { passwordHash, disabled: false, role: "user", mustChangePassword: false };
}

let dir = "";
let file = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-users-schema-"));
  file = path.join(dir, "users.yaml");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("password_changed_at", () => {
  beforeEach(async () => {
    await writeUsersFile(file, { users: new Map([["alice", user("h0")]]) });
  });

  it("round-trips the ISO timestamp under the snake_case key", async () => {
    const changedAt = "2026-11-22T01:02:03.456Z";
    await writeUsersFile(file, {
      users: new Map([["alice", { ...user("h"), passwordChangedAt: changedAt }]]),
    });
    expect(await fs.readFile(file, "utf8")).toContain(`password_changed_at: ${changedAt}`);
    const reloaded = (await loadUsersFile(file)).snapshot.users.get("alice");
    expect(reloaded?.passwordChangedAt).toBe(changedAt);
  });

  it("is optional: an absent key stays absent on a load/write round trip", async () => {
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.passwordChangedAt).toBeUndefined();
    await writeUsersFile(file, snapshot);
    expect(await fs.readFile(file, "utf8")).not.toContain("password_changed_at");
  });

  it("rejects a value that is not a parseable timestamp", async () => {
    const invalid = path.join(dir, "invalid.yaml");
    await fs.writeFile(
      invalid,
      `version: 1
users:
  alice:
    passwordHash: h
    password_changed_at: not-a-date
`,
      { mode: 0o600 },
    );
    await expect(loadUsersFile(invalid)).rejects.toBeInstanceOf(UsersFileError);
    await expect(loadUsersFile(invalid)).rejects.toThrow(/password_changed_at/);
  });
});

describe("reserved usernames (G12)", () => {
  it("isValidUsername rejects reserved names case-insensitively and bad formats", () => {
    expect(isValidUsername("alice")).toBe(true);
    expect(isValidUsername("alice.b-1")).toBe(true);
    expect(isValidUsername("bootstrap2")).toBe(true); // 只有精确的预留名被占
    for (const name of [
      "bootstrap",
      "Bootstrap",
      "BOOTSTRAP",
      "@bootstrap",
      "bad name",
      "",
      "-leading",
    ]) {
      expect(isValidUsername(name)).toBe(false);
    }
  });

  it("mutateUsersFile refuses to create a reserved or malformed username", async () => {
    await writeUsersFile(file, { users: new Map([["alice", user("h0")]]) });
    for (const name of ["bootstrap", "Bootstrap", "@bootstrap", "bad name"]) {
      await expect(
        mutateUsersFile(file, (snapshot) => {
          snapshot.users.set(name, user("h1"));
        }),
      ).rejects.toThrow(`invalid username: ${name}`);
    }
    // 被拒的创建不落盘、不留锁。
    expect([...(await loadUsersFile(file)).snapshot.users.keys()]).toEqual(["alice"]);
    await expect(fs.stat(`${file}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still loads and maintains a legacy user named bootstrap (no lock-out)", async () => {
    await fs.writeFile(
      file,
      `version: 1
users:
  bootstrap:
    passwordHash: h
`,
      { mode: 0o600 },
    );
    expect((await loadUsersFile(file)).snapshot.users.get("bootstrap")?.passwordHash).toBe("h");
    await mutateUsersFile(file, (snapshot) => {
      snapshot.users.get("bootstrap")!.disabled = true;
    });
    expect((await loadUsersFile(file)).snapshot.users.get("bootstrap")?.disabled).toBe(true);
  });
});
