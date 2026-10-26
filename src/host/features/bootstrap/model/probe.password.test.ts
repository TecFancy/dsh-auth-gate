import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeUsersFile, type UserRecord } from "../../../entities/user/index.js";
import { makeConfiguredProbe } from "./probe.js";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-auth-probe-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

function probeFor(usersPath: string): ReturnType<typeof makeConfiguredProbe> {
  return makeConfiguredProbe({
    mode: "password",
    usersPath,
    markedConfigured: { value: false },
  });
}

const ALICE: UserRecord = {
  passwordHash: "scrypt$1$2$3$4$hash",
  disabled: false,
  role: "admin",
};

describe("makeConfiguredProbe (password mode)", () => {
  it("reads a missing users file as unconfigured", async () => {
    const probe = probeFor(join(await tempDir(), "users.yaml"));
    expect(await probe.state()).toBe("unconfigured");
  });

  it("reads a users file without accounts as unconfigured", async () => {
    const usersPath = join(await tempDir(), "users.yaml");
    await writeUsersFile(usersPath, { users: new Map() });
    expect(await probeFor(usersPath).state()).toBe("unconfigured");
  });

  it("reads a users file with one account as configured", async () => {
    const usersPath = join(await tempDir(), "users.yaml");
    await writeUsersFile(usersPath, { users: new Map([["alice", ALICE]]) });
    expect(await probeFor(usersPath).state()).toBe("configured");
  });

  it("reads an unparseable users file as unknown", async () => {
    const usersPath = join(await tempDir(), "users.yaml");
    await writeFile(usersPath, "version: 1\nusers: [", { mode: 0o600 });
    expect(await probeFor(usersPath).state()).toBe("unknown");
  });

  it.skipIf(process.platform === "win32")(
    "reads a world-readable users file as unknown",
    async () => {
      const usersPath = join(await tempDir(), "users.yaml");
      await writeUsersFile(usersPath, { users: new Map([["alice", ALICE]]) });
      await chmod(usersPath, 0o644);
      expect(await probeFor(usersPath).state()).toBe("unknown");
    },
  );

  it("stops probing once the wizard marks the instance configured", async () => {
    const markedConfigured = { value: false };
    const probe = makeConfiguredProbe({
      mode: "password",
      usersPath: join(await tempDir(), "users.yaml"),
      markedConfigured,
    });
    expect(await probe.state()).toBe("unconfigured");
    probe.markConfigured();
    expect(await probe.state()).toBe("configured");
  });
});
