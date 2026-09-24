import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleUserTotp, totpUri, type TotpCliIo } from "./cli.js";
import { base32Decode } from "./index.js";
import { loadUsersFile, mutateUsersFile, type UserRecord } from "../../shared/index.js";

interface Harness {
  io: TotpCliIo;
  out: string[];
  err: string[];
}

function makeIo(): Harness {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

/** 直接落一份 users.yaml：role/disabled/mustChangePassword 三态齐全，供「不被抹掉」断言。 */
async function seed(file: string, name: string, record: Partial<UserRecord> = {}): Promise<void> {
  await mutateUsersFile(file, (snapshot) => {
    snapshot.users.set(name, {
      passwordHash: "scrypt$seed$hash",
      disabled: false,
      role: "user",
      mustChangePassword: false,
      ...record,
    });
  });
}

describe("dsh-auth user totp (slice, lock-protected RMW)", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-totp-slice-"));
    file = path.join(dir, "users.yaml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("enable adds the secret without dropping role / must-change flags", async () => {
    await seed(file, "root", { role: "admin", mustChangePassword: true });
    const h = makeIo();
    expect(await handleUserTotp(file, "enable", "root", h.io)).toBe(0);
    expect(h.err).toEqual([]);
    const user = (await loadUsersFile(file)).snapshot.users.get("root");
    expect(user?.totpSecret).toBeDefined();
    expect(base32Decode(user!.totpSecret!).length).toBe(20);
    expect(user?.role).toBe("admin");
    expect(user?.mustChangePassword).toBe(true);
    expect(user?.disabled).toBe(false);
    expect(h.out.join("\n")).toContain(user!.totpSecret!);
  });

  it("disable removes only the secret and keeps the other fields", async () => {
    await seed(file, "root", { role: "admin", mustChangePassword: true });
    expect(await handleUserTotp(file, "enable", "root", makeIo().io)).toBe(0);
    const h = makeIo();
    expect(await handleUserTotp(file, "disable", "root", h.io)).toBe(0);
    expect(h.out.join("\n")).toContain("TOTP disabled");
    const user = (await loadUsersFile(file)).snapshot.users.get("root");
    expect(user?.totpSecret).toBeUndefined();
    expect(user?.role).toBe("admin");
    expect(user?.mustChangePassword).toBe(true);
  });

  it("disable keeps a disabled user disabled (idempotent)", async () => {
    await seed(file, "guest", { disabled: true });
    expect(await handleUserTotp(file, "disable", "guest", makeIo().io)).toBe(0);
    expect(await handleUserTotp(file, "disable", "guest", makeIo().io)).toBe(0);
    const user = (await loadUsersFile(file)).snapshot.users.get("guest");
    expect(user?.disabled).toBe(true);
    expect(user?.role).toBe("user");
  });

  it("rejects an unknown user without creating it", async () => {
    const h = makeIo();
    expect(await handleUserTotp(file, "enable", "ghost", h.io)).toBe(1);
    expect(h.err.join("\n")).toContain("not found");
    expect((await loadUsersFile(file)).snapshot.users.has("ghost")).toBe(false);
  });

  it("rejects enabling twice and keeps the first secret", async () => {
    await seed(file, "root");
    expect(await handleUserTotp(file, "enable", "root", makeIo().io)).toBe(0);
    const secret = (await loadUsersFile(file)).snapshot.users.get("root")?.totpSecret;
    const h = makeIo();
    expect(await handleUserTotp(file, "enable", "root", h.io)).toBe(1);
    expect(h.err.join("\n")).toContain("already has a TOTP secret");
    expect((await loadUsersFile(file)).snapshot.users.get("root")?.totpSecret).toBe(secret);
  });

  it("keeps the otpauth URI contract", () => {
    const label = encodeURIComponent("dsh-auth:alice");
    expect(totpUri("alice", "ABCDEF")).toBe(
      `otpauth://totp/${label}?secret=ABCDEF&issuer=${encodeURIComponent("dsh-auth")}`,
    );
  });
});
