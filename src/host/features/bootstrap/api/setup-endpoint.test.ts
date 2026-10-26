import { describe, expect, it } from "vitest";
import {
  getSetupPage,
  makeSetupHarness,
  postSetupForm,
} from "../../../../../test/bootstrap-harness.js";
import type { SetupTokenOutcome } from "./setup-endpoint.js";

const LOGIN_REDIRECT = "/auth/login?next=%2F";
const TRUSTED = { "sec-fetch-site": "same-origin" };
const NAVIGATION = { "sec-fetch-dest": "document" };

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function cookieToken(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

describe("GET /auth/setup", () => {
  it("renders the wizard for a bootstrap session", async () => {
    const harness = makeSetupHarness({ mode: "token" });
    const res = await getSetupPage(harness, await harness.cookie());
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('action="/auth/setup"');
    expect(res.body).toContain("Generate access token");
    expect(res.body).toContain("DSH_AUTH_TOKEN");
    expect(res.body).toContain("604800 seconds");
    expect(res.body).toContain("cordis.patch.yml");
    expect(res.body).not.toContain("/?token=");
  });

  it("renders the administrator form in password mode", async () => {
    const harness = makeSetupHarness({ mode: "password" });
    const res = await getSetupPage(harness, await harness.cookie());
    expect(res.body).toContain('name="username"');
    expect(res.body).toContain('name="confirm"');
    expect(res.body).toContain("Create administrator");
    expect(res.body).toContain("users.yaml");
  });

  it("sends an anonymous visitor to the login page", async () => {
    const res = await getSetupPage(makeSetupHarness());
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(LOGIN_REDIRECT);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("sends a visitor to the login page when the session store is missing", async () => {
    const res = await getSetupPage(makeSetupHarness({ store: undefined }), "dsh_auth=x");
    expect(res.headers["location"]).toBe(LOGIN_REDIRECT);
  });

  it("shows the already-configured page to a full session", async () => {
    const harness = makeSetupHarness();
    const res = await getSetupPage(harness, await harness.cookie("full"));
    expect(res.status).toBe(200);
    expect(res.body).toContain("Already configured");
    expect(res.body).not.toContain("Generate access token");
  });
});

describe("POST /auth/setup (token mode)", () => {
  it("saves the token, closes the window and shows it exactly once", async () => {
    const harness = makeSetupHarness({ mode: "token" });
    const cookie = await harness.cookie();
    const res = await postSetupForm(harness, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.split("new-token").length - 1).toBe(1);
    expect(res.body).toContain('href="/auth/continue"');
    expect(harness.issued).toEqual(["token"]);
    // 旧的 bootstrap 会话已吊销，正式会话另发一枚。
    expect(harness.store.getByToken(cookieToken(cookie))).toBeUndefined();
    expect(res.headers["set-cookie"]).toContain("dsh_auth=");
  });

  it("asks for a restart when the new token cannot be read back", async () => {
    const harness = makeSetupHarness({
      mode: "token",
      saveToken: () => Promise.resolve({ status: "saved-unreadable", token: "new-token" }),
    });
    const res = await postSetupForm(harness, { cookie: await harness.cookie() });
    expect(res.status).toBe(200);
    expect(res.body).toContain("Restart dsh");
  });

  it("fails with a fixed sentence and no secret when the write fails", async () => {
    const harness = makeSetupHarness({
      mode: "token",
      saveToken: (): Promise<SetupTokenOutcome> => Promise.resolve({ status: "failed" }),
    });
    const res = await postSetupForm(harness, { cookie: await harness.cookie() });
    expect(res.status).toBe(500);
    expect(res.body).toContain("DSH_AUTH_TOKEN");
    expect(harness.issued).toEqual([]);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(harness.logs.some((log) => log.level === "warn")).toBe(true);
  });

  it("rejects an untrusted origin before touching the store", async () => {
    let saves = 0;
    const harness = makeSetupHarness({
      mode: "token",
      saveToken: () => {
        saves += 1;
        return Promise.resolve({ status: "saved", token: "new-token" });
      },
    });
    const res = await postSetupForm(harness, { cookie: await harness.cookie(), headers: {} });
    expect(res.status).toBe(403);
    expect(res.body).toBe("untrusted origin");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(saves).toBe(0);
  });
});

describe("POST /auth/setup (password mode)", () => {
  const PASS = form({ username: "alice", password: "Sup3r-secret-pw", confirm: "Sup3r-secret-pw" });

  it("creates the administrator, closes the window and continues to dsh", async () => {
    const harness = makeSetupHarness({ mode: "password" });
    const cookie = await harness.cookie();
    const res = await postSetupForm(harness, { cookie, body: PASS });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/continue");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(harness.issued).toEqual(["alice"]);
    expect(harness.store.getByToken(cookieToken(cookie))).toBeUndefined();
  });

  it("re-renders the form on a password mismatch without calling createAdmin", async () => {
    let created = 0;
    const harness = makeSetupHarness({
      mode: "password",
      createAdmin: () => {
        created += 1;
        return Promise.resolve("ok");
      },
    });
    const res = await postSetupForm(harness, {
      cookie: await harness.cookie(),
      body: form({ username: "alice", password: "Sup3r-secret-pw", confirm: "other" }),
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain("do not match");
    expect(created).toBe(0);
  });

  it("re-renders the form with the policy copy when the password is too weak", async () => {
    const harness = makeSetupHarness({
      mode: "password",
      createAdmin: () => Promise.resolve("invalid"),
    });
    const res = await postSetupForm(harness, {
      cookie: await harness.cookie(),
      body: form({ username: "alice", password: "weak", confirm: "weak" }),
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain("at least 14 characters");
    expect(res.body).toContain('name="username"');
  });

  it("reports an existing username as a conflict", async () => {
    const harness = makeSetupHarness({
      mode: "password",
      createAdmin: () => Promise.resolve("conflict"),
    });
    const res = await postSetupForm(harness, { cookie: await harness.cookie(), body: PASS });
    expect(res.status).toBe(400);
    expect(res.body).toContain("already exists");
  });

  it("fails with a fixed sentence when the users file cannot be written", async () => {
    const harness = makeSetupHarness({
      mode: "password",
      createAdmin: () => Promise.resolve("failed"),
    });
    const res = await postSetupForm(harness, { cookie: await harness.cookie(), body: PASS });
    expect(res.status).toBe(500);
    expect(res.body).toContain("Could not create the administrator account");
    expect(harness.issued).toEqual([]);
  });
});

describe("POST /auth/setup (guards)", () => {
  it("refuses a post without a bootstrap session", async () => {
    const harness = makeSetupHarness();
    const navigation = await postSetupForm(harness, {
      headers: { ...TRUSTED, ...NAVIGATION },
    });
    expect(navigation.status).toBe(302);
    expect(navigation.headers["location"]).toBe(LOGIN_REDIRECT);

    const api = await postSetupForm(harness);
    expect(api.status).toBe(401);
    expect(api.body).toBe("unauthorized");
  });

  it("refuses a full session, which must not run the wizard again", async () => {
    const harness = makeSetupHarness();
    const res = await postSetupForm(harness, {
      cookie: await harness.cookie("full"),
      headers: { ...TRUSTED, ...NAVIGATION },
    });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(LOGIN_REDIRECT);
    expect(harness.issued).toEqual([]);
  });

  it("rejects a non-form content type", async () => {
    const harness = makeSetupHarness();
    const res = await postSetupForm(harness, {
      cookie: await harness.cookie(),
      body: "{}",
      form: false,
    });
    expect(res.status).toBe(415);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("accepts a same-origin browser form even when publicHost is unset", async () => {
    const harness = makeSetupHarness({ mode: "token", publicHost: "" });
    const res = await postSetupForm(harness, { cookie: await harness.cookie() });
    expect(res.status).toBe(200);
    expect(harness.issued).toEqual(["token"]);
  });
});
