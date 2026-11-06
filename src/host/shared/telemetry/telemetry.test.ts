/**
 * 匿名使用统计的单元测试。
 *
 * 这里每一个失败模式都是静默的：关掉了还发、每个请求都发、报文里混进路径、抛错落到放行它的
 * 请求上 - 只读正常路径看不出这些。下面覆盖了共享契约点名的六种情况，外加 metrics 与 installId
 * 的读取器；每个用例都替换掉网络和时钟，测试从不开 socket、也不真的等一天。
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildPayload,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  TELEMETRY_ENDPOINT,
  usersBucket,
} from "./telemetry.js";
import {
  bodyOf,
  flush,
  harness,
  sortedKeys,
  STORED_ID,
} from "../../../../test/telemetry-harness.js";

describe("匿名上报：开关与节奏", () => {
  it("sends nothing while the telemetry setting is off", async () => {
    const report = harness({ enabled: false });
    for (let request = 0; request < 3; request += 1) report.telemetry.noteAdmitted();
    report.advance(PING_INTERVAL_MS);
    report.telemetry.noteAdmitted();
    await flush();

    expect(report.telemetry.enabled).toBe(false);
    expect(report.requests).toHaveLength(0);
    // 没有请求也就没有 id，更不会往配置里写什么。
    expect(report.saved).toHaveLength(0);
  });

  it("sends at most one ping in 24 hours in one process", async () => {
    const report = harness();
    report.telemetry.noteAdmitted();
    report.telemetry.noteAdmitted();
    await flush();
    expect(report.sent).toHaveLength(1);

    report.advance(PING_INTERVAL_MS - 1);
    report.telemetry.noteAdmitted();
    await flush();
    expect(report.sent).toHaveLength(1);

    report.advance(1);
    report.telemetry.noteAdmitted();
    await flush();
    expect(report.sent).toHaveLength(2);
  });

  it("sends nothing at all on a broken clock, and never rethrows", async () => {
    const broken = harness({
      now: () => {
        throw new Error("clock");
      },
    });
    expect(() => broken.telemetry.noteAdmitted()).not.toThrow();
    await flush();
    expect(broken.requests).toHaveLength(0);
  });
});

describe("匿名上报：报文", () => {
  it("sends exactly the payload keys the contract names", async () => {
    const report = harness({ totp: "optional", users: () => 3 });
    report.telemetry.noteAdmitted();
    await flush();

    expect(report.requests).toHaveLength(1);
    expect(report.requests[0]?.url).toBe(TELEMETRY_ENDPOINT);
    expect(report.requests[0]?.init.method).toBe("POST");
    expect((report.requests[0]?.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );

    const payload = report.sent[0]!;
    expect(sortedKeys(payload)).toEqual([
      "arch",
      "id",
      "metrics",
      "node",
      "os",
      "pkg",
      "v",
      "version",
    ]);
    expect(sortedKeys(payload.metrics)).toEqual(["mode", "totp", "users"]);
    expect(payload).toMatchObject({
      v: 1,
      pkg: "dsh-auth-gate",
      metrics: { mode: "password", totp: "optional", users: "2-5" },
    });
    expect(payload.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(payload.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(payload.node).toMatch(/^v\d+$/);
    expect(["linux", "darwin", "win32", "other"]).toContain(payload.os);
    expect(["x64", "arm64", "other"]).toContain(payload.arch);
  });

  it("stays silent when the request fails or takes too long, and never rethrows", async () => {
    const failing = harness({}, () => Promise.reject(new Error("offline")));
    expect(() => failing.telemetry.noteAdmitted()).not.toThrow();
    await flush();
    expect(failing.requests).toHaveLength(1);
    expect(failing.sent).toHaveLength(0);

    vi.useFakeTimers();
    const seen: { signal: AbortSignal | null } = { signal: null };
    const hanging = harness({}, (_url, init) => {
      const { signal } = init;
      seen.signal = signal ?? null;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    expect(() => hanging.telemetry.noteAdmitted()).not.toThrow();
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS);
    vi.useRealTimers();

    expect(seen.signal).not.toBeNull();
    expect(seen.signal?.aborted).toBe(true);
  });

  it("never carries a path, a user name, a password hash or a TOTP secret", async () => {
    const report = harness({ installId: () => STORED_ID, users: () => 2 });
    report.telemetry.noteAdmitted();
    await flush();

    const body = bodyOf(report.requests[0]?.init);
    for (const forbidden of [
      "/",
      "\\",
      "/home",
      "users.yaml",
      "alice",
      "scrypt",
      "otpauth",
      "secret",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("匿名上报：installId", () => {
  it("generates the install id once and reuses it", async () => {
    const report = harness();
    report.telemetry.noteAdmitted();
    await flush();
    report.advance(PING_INTERVAL_MS);
    report.telemetry.noteAdmitted();
    await flush();

    expect(report.sent).toHaveLength(2);
    expect(report.sent[0]?.id).toBe(report.sent[1]?.id);
    // 第二次读到的是同一个值：写回之后 config 里就是它，且只写一次。
    expect(report.storedId()).toBe(report.sent[0]?.id);
    expect(report.saved).toEqual([report.sent[0]?.id]);

    const stored = harness({ installId: () => STORED_ID });
    stored.telemetry.noteAdmitted();
    await flush();
    expect(stored.sent[0]?.id).toBe(STORED_ID);
    expect(stored.saved).toHaveLength(0);
  });

  it("keeps using the generated id in memory when the settings write fails", async () => {
    let attempts = 0;
    const report = harness({
      settings: () => ({
        update: () => {
          attempts += 1;
          return Promise.reject(new Error("read-only profile"));
        },
      }),
    });
    report.telemetry.noteAdmitted();
    await flush();
    report.advance(PING_INTERVAL_MS);
    report.telemetry.noteAdmitted();
    await flush();

    expect(report.sent).toHaveLength(2);
    expect(report.sent[0]?.id).toBe(report.sent[1]?.id);
    // 写失败不抛出；下一次上报再试一次。
    expect(attempts).toBe(2);
  });

  it("still reports when the host has no settings service, keeping the id in memory", async () => {
    const report = harness({ settings: () => undefined });
    report.telemetry.noteAdmitted();
    await flush();
    expect(report.telemetry.enabled).toBe(true);
    expect(report.sent).toHaveLength(1);
    // 没有写回通道：配置里什么都没写，但 id 在内存里，本进程内保持不变。
    expect(report.saved).toHaveLength(0);

    report.advance(PING_INTERVAL_MS);
    report.telemetry.noteAdmitted();
    await flush();
    expect(report.sent).toHaveLength(2);
    expect(report.sent[0]?.id).toBe(report.sent[1]?.id);
  });
});

describe("metrics 与报文的读取器", () => {
  it("buckets the configured user count at the contract's edges", () => {
    expect(usersBucket(undefined)).toBeUndefined();
    expect(usersBucket(0)).toBeUndefined();
    expect(usersBucket(1)).toBe("1");
    expect(usersBucket(2)).toBe("2-5");
    expect(usersBucket(5)).toBe("2-5");
    expect(usersBucket(6)).toBe("6+");
    expect(usersBucket(20)).toBe("6+");
  });

  it("reports one user in token mode whatever the reader says", async () => {
    const report = harness({ mode: "token", users: () => 7 });
    report.telemetry.noteAdmitted();
    await flush();
    expect(report.sent[0]?.metrics).toEqual({ mode: "token", totp: "off", users: "1" });
  });

  it("reuses a parsed count and reads users.yaml lazily only when nothing parsed it", async () => {
    const parsed = harness({ users: () => 6 });
    parsed.telemetry.noteAdmitted();
    await flush();
    expect(parsed.sent[0]?.metrics.users).toBe("6+");

    let reads = 0;
    const lazy = harness({
      users: () => undefined,
      readUsers: () => {
        reads += 1;
        return Promise.resolve(2);
      },
    });
    lazy.telemetry.noteAdmitted();
    await flush();
    expect(lazy.sent[0]?.metrics.users).toBe("2-5");
    expect(reads).toBe(1);
    // 24 小时窗口内的后续放行请求不再读盘。
    lazy.telemetry.noteAdmitted();
    await flush();
    expect(reads).toBe(1);
  });

  it("sends nothing when the count is unknown and nothing can read it", async () => {
    const report = harness({ users: () => undefined });
    report.telemetry.noteAdmitted();
    await flush();
    expect(report.requests).toHaveLength(0);
  });

  it("maps the machine onto the contract's closed sets", () => {
    const base = {
      manifest: { pkg: "dsh-auth-gate", version: "0.18.1" },
      id: STORED_ID,
      metrics: { mode: "token" as const, totp: "off" as const, users: "1" as const },
    };
    expect(
      buildPayload({
        ...base,
        host: { nodeVersion: "22.11.0", platform: "freebsd", arch: "ia32" },
      }),
    ).toMatchObject({ node: "v22", os: "other", arch: "other" });
    expect(
      buildPayload({ ...base, host: { nodeVersion: "20.1.0", platform: "darwin", arch: "arm64" } }),
    ).toMatchObject({ node: "v20", os: "darwin", arch: "arm64" });
  });
});
