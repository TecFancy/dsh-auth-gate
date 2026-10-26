import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadUsersFile } from "./host/entities/user/index.js";
import { BOOTSTRAP_PATH, CONTINUE_PATH, SETUP_PATH } from "./host/shared/protocol/index.js";
import { fakeReq, makeRes } from "../test/bootstrap-harness.js";
import {
  LAUNCH,
  LOGIN_REDIRECT,
  makeWiringHarness,
  type Credentials,
} from "../test/bootstrap-wiring-harness.js";

const directories: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-auth-wiring-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function tokenCookie(token: string): string {
  return token.slice(token.indexOf("=") + 1);
}

describe("makeBootstrapWiring: routes", () => {
  it("mounts the three first-run routes and unregisters them on dispose", async () => {
    const harness = makeWiringHarness({ mount: false });
    const dispose = harness.wiring.mount();
    expect([...harness.server.routes.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
      BOOTSTRAP_PATH,
      CONTINUE_PATH,
      SETUP_PATH,
    ]);
    dispose();
    expect(harness.server.routes.size).toBe(0);

    const anonymous = makeRes();
    await makeWiringHarness().handler(SETUP_PATH)(fakeReq({ url: SETUP_PATH }), anonymous.res);
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers["location"]).toBe(LOGIN_REDIRECT);
  });

  it("keeps the method matrix of the continue endpoint on the route table", async () => {
    const res = makeRes();
    await makeWiringHarness().handler(CONTINUE_PATH)(
      fakeReq({ method: "PUT", url: CONTINUE_PATH }),
      res.res,
    );
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET");
  });
});

describe("makeBootstrapWiring: token mode", () => {
  it("saves a fresh token into the credential store and closes the window at once", async () => {
    const values = new Map<string, string>();
    const credentials: Credentials = {
      resolve: (ref) => Promise.resolve(values.has(ref) ? { value: values.get(ref)! } : undefined),
      set: (ref, value) => {
        values.set(ref, value);
        return Promise.resolve();
      },
    };
    const harness = makeWiringHarness({ credentials });
    expect(await harness.wiring.probe.state()).toBe("unconfigured");
    const res = await harness.post();
    const token = values.get("DSH_AUTH_TOKEN");
    expect(token).toBeTruthy();
    expect(res.status).toBe(200);
    expect(res.body.split(token!).length - 1).toBe(1);
    expect(harness.wiring.markedConfigured.value).toBe(true);
    expect(await harness.wiring.probe.state()).toBe("configured");
    // 令牌绝不写日志。
    expect(JSON.stringify(harness.logs)).not.toContain(token!);
  });

  it("fails closed when the credential store cannot write, without leaking a token", async () => {
    const harness = makeWiringHarness({
      credentials: { resolve: () => Promise.resolve(undefined) },
    });
    const res = await harness.post();
    expect(res.status).toBe(500);
    expect(res.body).toContain("DSH_AUTH_TOKEN");
    expect(harness.wiring.markedConfigured.value).toBe(false);
    expect(await harness.wiring.probe.state()).toBe("unconfigured");
    expect(harness.logs.some((log) => log.level === "warn")).toBe(true);
  });

  it("reports saved-unreadable when the write lands but reads back nothing", async () => {
    const harness = makeWiringHarness({
      credentials: { resolve: () => Promise.resolve(undefined), set: () => Promise.resolve() },
    });
    const res = await harness.post();
    expect(res.status).toBe(200);
    expect(res.body).toContain("Restart dsh");
    expect(harness.wiring.markedConfigured.value).toBe(true);
  });
});

describe("makeBootstrapWiring: password mode", () => {
  it("writes the first administrator into a real users.yaml", async () => {
    const usersPath = join(await tempDir(), "users.yaml");
    const harness = makeWiringHarness({ mode: "password", usersPath });
    const res = await harness.post(
      form({ username: "root", password: "Sup3r-secret-pw", confirm: "Sup3r-secret-pw" }),
    );
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(CONTINUE_PATH);
    const record = (await loadUsersFile(usersPath)).snapshot.users.get("root");
    expect(record?.role).toBe("admin");
    expect(record?.disabled).toBe(false);
    expect(record?.passwordHash).not.toContain("Sup3r-secret-pw");
    expect(harness.wiring.markedConfigured.value).toBe(true);
  });

  it("rejects a weak password and an invalid username before touching the file", async () => {
    const usersPath = join(await tempDir(), "users.yaml");
    const cases = [
      { username: "root", password: "short" },
      { username: "-bad name", password: "Sup3r-secret-pw" },
    ];
    for (const testCase of cases) {
      const harness = makeWiringHarness({ mode: "password", usersPath });
      const res = await harness.post(form({ ...testCase, confirm: testCase.password }));
      expect({ user: testCase.username, status: res.status }).toEqual({
        user: testCase.username,
        status: 400,
      });
      expect(harness.wiring.markedConfigured.value).toBe(false);
    }
    expect((await loadUsersFile(usersPath)).missing).toBe(true);
  });
});

describe("makeBootstrapWiring: startup sweep", () => {
  it("revokes stale bootstrap sessions only on a configured instance", async () => {
    const configured = makeWiringHarness({
      credentials: { resolve: () => Promise.resolve({ value: "live" }) },
    });
    const stale = tokenCookie(await configured.cookie());
    configured.wiring.onSessionsReady(configured.store);
    await waitFor(() => configured.store.getByToken(stale) === undefined);
    expect(configured.logs.some((log) => String(log.message).includes("stale bootstrap"))).toBe(
      true,
    );

    const fresh = makeWiringHarness({ credentials: { resolve: () => Promise.resolve(undefined) } });
    const kept = tokenCookie(await fresh.cookie());
    fresh.wiring.onSessionsReady(fresh.store);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fresh.store.getByToken(kept)?.kind).toBe("bootstrap");
  });
});

describe("makeBootstrapWiring: strict token probe", () => {
  const bootstrapHit = `${BOOTSTRAP_PATH}?token=${LAUNCH}`;

  it("reads a failing credential resolve as unknown and issues no bootstrap session", async () => {
    const harness = makeWiringHarness({
      credentials: { resolve: () => Promise.reject(new Error("credentials not ready")) },
    });
    expect(await harness.wiring.probe.state()).toBe("unknown");
    const res = makeRes();
    await harness.handler(BOOTSTRAP_PATH)(fakeReq({ url: bootstrapHit }), res.res);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(LOGIN_REDIRECT);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("reads a missing credentials service as unknown instead of unconfigured", async () => {
    const harness = makeWiringHarness();
    expect(await harness.wiring.probe.state()).toBe("unknown");
    const res = makeRes();
    await harness.handler(BOOTSTRAP_PATH)(fakeReq({ url: bootstrapHit }), res.res);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(LOGIN_REDIRECT);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("opens the window only for a healthy resolve that returns nothing", async () => {
    const harness = makeWiringHarness({
      credentials: { resolve: () => Promise.resolve(undefined) },
    });
    expect(await harness.wiring.probe.state()).toBe("unconfigured");
    const res = makeRes();
    await harness.handler(BOOTSTRAP_PATH)(fakeReq({ url: bootstrapHit }), res.res);
    expect(res.headers["location"]).toBe("/auth/setup");
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
  });
});
