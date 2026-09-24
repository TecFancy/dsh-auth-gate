import { describe, expect, it } from "vitest";
import {
  CURRENT,
  GOOD_BODY,
  NEW_PASSWORD,
  activeUser,
  formBody,
  jsonBody,
  makeHarness,
  makeReq,
  makeRes,
  type FakeRes,
} from "../../../test/password-change-harness.js";
import { handlePasswordChange, type PasswordChangeDeps } from "./password-change.js";

/** 带同源证明的 POST（浏览器表单与同源 fetch 恒带 Sec-Fetch-Site）。 */
async function post(
  deps: PasswordChangeDeps,
  body: string,
  headers: Record<string, string> = {},
): Promise<FakeRes> {
  const res = makeRes();
  const req = makeReq({ body });
  req.headers["sec-fetch-site"] = "same-origin";
  Object.assign(req.headers, headers);
  await handlePasswordChange(deps, req, res.res);
  return res;
}

/** GET 直达（拿 Location 断言用）。 */
async function get(
  deps: PasswordChangeDeps,
  url: string,
  cookie: string | null = null,
): Promise<FakeRes> {
  const res = makeRes();
  const req = makeReq({ method: "GET", cookie });
  req.url = url;
  await handlePasswordChange(deps, req, res.res);
  return res;
}

/** SSR 表单提交的 body：`current` + `password` + 隐藏字段 `nav=1`。 */
const NAV_BODY = formBody({ current: CURRENT, password: NEW_PASSWORD, nav: "1" });

/** 受限会话（must_change_password 登录门签发的 kind）：复用夹具会话对象打上 kind。 */
function restrictedHarness(): ReturnType<typeof makeHarness> {
  const h = makeHarness({}, activeUser({ mustChangePassword: true }));
  const session = h.store.store.getByToken("good");
  if (session === undefined) throw new Error("harness session missing");
  session.kind = "password-change-only";
  return h;
}

describe("nav=1 response shaping (contract 26/31)", () => {
  it("sends an SSR navigation back to the login page with the notice and clears the cookie", async () => {
    const h = makeHarness();
    const res = await post(h.deps, NAV_BODY);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/login?notice=password-changed");
    expect(res.headers["set-cookie"]).toContain("dsh_auth=; Max-Age=0");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toBeUndefined();
  });

  it("changes the password, revokes every session including the current one", async () => {
    const h = makeHarness();
    await post(h.deps, NAV_BODY);
    expect(h.users.get("alice")?.passwordHash).toBe("scrypt$65536$8$1$new");
    expect(h.state.writes).toBe(1);
    expect(h.state.revokes).toBe(1);
    expect(h.store.has("good")).toBe(false);
  });

  it("keeps the P1 JSON contract when nav is absent", async () => {
    const h = makeHarness();
    const res = await post(h.deps, GOOD_BODY);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(jsonBody(res)).toEqual({ ok: true });
  });

  it("never sniffs Accept to pick the response shape", async () => {
    for (const accept of ["text/html", "text/html,application/xhtml+xml", "*/*"]) {
      const res = await post(makeHarness().deps, GOOD_BODY, { accept });
      expect([accept, res.status, res.headers["content-type"]]).toEqual([
        accept,
        200,
        "application/json",
      ]);
    }
  });

  it("requires an exact nav=1 value (no truthy parsing)", async () => {
    for (const nav of ["true", "yes", "01", "1 "]) {
      const res = await post(
        makeHarness().deps,
        formBody({ current: CURRENT, password: NEW_PASSWORD, nav }),
      );
      expect([nav, res.status]).toEqual([nav, 200]);
    }
  });
});

describe("restricted session keeps the `current` requirement (contract 27)", () => {
  it("still changes the password with nav=1, kills the restricted cookie and clears the flag", async () => {
    const h = restrictedHarness();
    const res = await post(h.deps, NAV_BODY);
    expect(res.status).toBe(302);
    expect(h.store.has("good")).toBe(false); // 不升级当前会话：旧 cookie 立即失效
    // 写盘侧对 false 不落盘：标记被删除即「无该字段」。
    expect(h.users.get("alice")?.mustChangePassword ?? false).toBe(false);
    expect(h.users.get("alice")?.passwordHash).toBe("scrypt$65536$8$1$new");
  });

  it("rejects a missing current with 401 and keeps the flag and the session", async () => {
    const h = restrictedHarness();
    const res = await post(h.deps, formBody({ password: NEW_PASSWORD, nav: "1" }));
    expect(res.status).toBe(401);
    expect(jsonBody(res)).toEqual({ error: "invalid_credentials" });
    expect(h.users.get("alice")?.mustChangePassword).toBe(true);
    expect(h.store.has("good")).toBe(true);
    expect(h.state.writes).toBe(0);
  });

  it("rejects a wrong current with 401 and keeps the flag and the session", async () => {
    const h = restrictedHarness();
    const res = await post(
      h.deps,
      formBody({ current: "wrong", password: NEW_PASSWORD, nav: "1" }),
    );
    expect(res.status).toBe(401);
    expect(h.users.get("alice")?.mustChangePassword).toBe(true);
    expect(h.store.has("good")).toBe(true);
  });
});

describe("Location never reflects request data (contract 35)", () => {
  it.each(["//evil.com", "https://evil.com", "\\\\evil", "/a/../../..", "javascript:alert(1)"])(
    "ignores a hostile next=%s on the unauthenticated GET",
    async (next) => {
      const res = await get(makeHarness().deps, `/auth/password?next=${encodeURIComponent(next)}`);
      expect(res.status).toBe(302);
      expect(res.headers["location"]).toBe("/auth/login?next=/auth/password");
    },
  );

  it("keeps the fixed success Location for an SSR navigation", async () => {
    const res = await post(makeHarness().deps, NAV_BODY, { referer: "https://evil.com/x" });
    expect(res.headers["location"]).toBe("/auth/login?notice=password-changed");
    expect(res.headers["location"]).not.toContain("evil");
  });
});
