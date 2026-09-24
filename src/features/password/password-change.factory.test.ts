import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LoginRateLimiter, loadUsersFile } from "../../shared/index.js";
import type { SessionStore } from "../../session/index.js";
import { makePasswordChangeWiring } from "./password-endpoints.js";

function noop(): boolean {
  return true;
}

const noopLog = {
  error: (): void => undefined,
  info: (): void => undefined,
};

function collectingLog(lines: string[]): {
  error(message: unknown): void;
  info(message: unknown): void;
} {
  return {
    error: (message) => lines.push(`ERROR ${String(message)}`),
    info: (message) => lines.push(String(message)),
  };
}

describe("makePasswordChangeWiring (§5 + §1.1-4)", () => {
  it("binds mutateUsers to usersPath through the real locked write", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-pwchange-"));
    const usersPath = join(root, "users.yaml");
    try {
      const wiring = makePasswordChangeWiring(usersPath, { sessions: undefined }, noop, noopLog);
      await wiring.mutateUsers((snapshot) => {
        snapshot.users.set("alice", {
          passwordHash: "written-by-wiring",
          disabled: false,
          role: "user",
          mustChangePassword: false,
        });
      });
      const loaded = await loadUsersFile(usersPath);
      expect(loaded.snapshot.users.get("alice")?.passwordHash).toBe("written-by-wiring");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("mints a fresh change limiter and forwards hash/replayCheck", async () => {
    const wiring = makePasswordChangeWiring(
      "/tmp/users.yaml",
      { sessions: undefined },
      noop,
      noopLog,
    );
    expect(wiring.limiter).toBeInstanceOf(LoginRateLimiter);
    expect(typeof wiring.mutateUsers).toBe("function");
    expect(wiring.replayCheck).toBe(noop);
    await expect(wiring.hash("NewPassw0rd!XY")).resolves.toContain("scrypt$65536$");
  });

  it("revokes the subject and logs the count", async () => {
    const logs: string[] = [];
    const store = { revokeBySubject: () => Promise.resolve(2) };
    const wiring = makePasswordChangeWiring(
      "/tmp/users.yaml",
      { sessions: store as unknown as SessionStore },
      noop,
      collectingLog(logs),
    );
    await wiring.revoke("alice");
    expect(logs).toEqual(["sessions revoked after password change: alice (2 sessions)"]);
  });

  it("never throws when the revoke fails and still logs the subject (200 semantics)", async () => {
    const logs: string[] = [];
    const store = { revokeBySubject: () => Promise.reject(new Error("session store down")) };
    const wiring = makePasswordChangeWiring(
      "/tmp/users.yaml",
      { sessions: store as unknown as SessionStore },
      noop,
      collectingLog(logs),
    );
    await expect(wiring.revoke("alice")).resolves.toBeUndefined();
    expect(logs).toEqual([
      "ERROR sessions not revoked after password change: alice (session store down)",
    ]);
  });

  it("logs when the session store is unavailable instead of throwing", async () => {
    const logs: string[] = [];
    const wiring = makePasswordChangeWiring(
      "/tmp/users.yaml",
      { sessions: undefined },
      noop,
      collectingLog(logs),
    );
    await expect(wiring.revoke("alice")).resolves.toBeUndefined();
    expect(logs).toEqual([
      "ERROR sessions not revoked after password change: alice (session store unavailable)",
    ]);
  });
});
