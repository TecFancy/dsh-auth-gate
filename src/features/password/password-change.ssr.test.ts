import { describe, expect, it } from "vitest";
import {
  activeUser,
  makeHarness,
  makeReq,
  makeRes,
  type FakeRes,
} from "../../../test/password-change-harness.js";
import { handlePasswordChange, type PasswordChangeDeps } from "./password-change.js";

/** GET 直达 `/auth/password`（P2 起该端点同时服务 SSR 页）。 */
async function get(
  deps: PasswordChangeDeps,
  url = "/auth/password",
  cookie: string | null = "dsh_auth=good",
): Promise<FakeRes> {
  const res = makeRes();
  const req = makeReq({ method: "GET", cookie });
  req.url = url;
  await handlePasswordChange(deps, req, res.res);
  return res;
}

/** 受限会话（must_change_password 登录门签发的 kind）：复用夹具会话对象打上 kind。 */
function restrictedHarness(): ReturnType<typeof makeHarness> {
  const h = makeHarness({}, activeUser({ mustChangePassword: true }));
  const session = h.store.store.getByToken("good");
  if (session === undefined) throw new Error("harness session missing");
  session.kind = "password-change-only";
  return h;
}

/** 把 HTML 里的 input 标签全部取出来（自足性断言用）。 */
function inputTags(html: string): string[] {
  return html.match(/<input[^>]*>/g) ?? [];
}

describe("GET /auth/password: session gate (contract 33)", () => {
  it("redirects an unauthenticated navigation to the login page with next (302, never 401)", async () => {
    const res = await get(makeHarness().deps, "/auth/password", null);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/login?next=/auth/password");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toBe("");
  });

  it("treats a stale cookie as unauthenticated and never renders a login page", async () => {
    const res = await get(makeHarness().deps, "/auth/password", "dsh_auth=stale");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/auth/login?next=/auth/password");
    expect(res.body).not.toContain("<form");
  });

  it("serves the form to a full session with the page cache headers", async () => {
    const res = await get(makeHarness().deps);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["pragma"]).toBe("no-cache");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("serves the same form to a password-change-only session", async () => {
    const res = await get(restrictedHarness().deps);
    expect(res.status).toBe(200);
    expect(res.body).toContain('name="current"');
  });
});

describe("SSR page self-sufficiency (contract 34)", () => {
  it("has zero external references and no script tag", async () => {
    const html = (await get(makeHarness().deps)).body;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("/plugins");
    expect(html).not.toContain("src=");
    expect(html).not.toContain("href=");
    expect(html).toContain("<style>");
  });

  it("carries the four fields, the autocomplete hints and the hidden nav marker", async () => {
    const html = (await get(makeHarness().deps)).body;
    expect(html).toContain('action="/auth/password"');
    expect(html).toContain('method="post"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html.match(/autocomplete="new-password"/g)).toHaveLength(2);
    expect(html).toContain('autocomplete="one-time-code"');
    for (const name of ["current", "password", "confirm", "code"]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('<input type="hidden" name="nav" value="1">');
  });

  it("never pre-fills a credential value (hidden nav is the only value attribute)", async () => {
    const html = (await get(makeHarness().deps)).body;
    const filled = inputTags(html).filter(
      (tag) => !tag.includes('type="hidden"') && tag.includes("value="),
    );
    expect(filled).toEqual([]);
    expect(inputTags(html).filter((tag) => tag.includes('type="hidden"'))).toHaveLength(1);
  });

  it("renders the whitelisted notice and ignores anything else", async () => {
    const shown = await get(makeHarness().deps, "/auth/password?notice=password-changed");
    expect(shown.body).toContain("Your password was changed. Sign in with your new password.");
    const hostile = await get(
      makeHarness().deps,
      "/auth/password?notice=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    );
    expect(hostile.body).not.toContain("alert(1)");
    expect(hostile.body).not.toContain("<script");
    expect(hostile.status).toBe(200);
  });
});

describe("GET /auth/password: side effects and method matrix (contract 36)", () => {
  it("writes nothing and never touches the write pipeline", async () => {
    const h = makeHarness();
    await get(h.deps);
    expect(h.state.writes).toBe(0);
    expect(h.state.revokes).toBe(0);
    expect(h.limiter.check("127.0.0.1", "alice").allowed).toBe(true);
  });

  it("answers other methods with 405 + allow: GET, POST + no-store", async () => {
    const res = makeRes();
    await handlePasswordChange(makeHarness().deps, makeReq({ method: "PUT", body: "" }), res.res);
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET, POST");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
