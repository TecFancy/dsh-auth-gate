import { describe, expect, it } from "vitest";
import { SessionStore } from "../../../entities/session/index.js";
import { fakeReq, makeRes, MemTable } from "../../../../../test/bootstrap-harness.js";
import { makeContinueEndpoint, type ContinueEndpointDeps } from "./continue-endpoint.js";

const LOGIN_REDIRECT = "/auth/login?next=%2F";

function harness(overrides: Partial<ContinueEndpointDeps> = {}): ContinueEndpointDeps {
  return {
    sessions: () => new SessionStore(new MemTable()),
    cookieName: "dsh_auth",
    bridge: () => Promise.resolve("/?token=launch-token"),
    logger: { warn: () => undefined },
    ...overrides,
  };
}

async function withSession(
  deps: Partial<ContinueEndpointDeps> = {},
): Promise<{ deps: ContinueEndpointDeps; cookie: string }> {
  const store = new SessionStore(new MemTable());
  const issued = await store.create("token", 60_000);
  return {
    deps: harness({ sessions: () => store, ...deps }),
    cookie: `dsh_auth=${issued.token}`,
  };
}

describe("GET /auth/continue", () => {
  it("sends the finished wizard to the launch-token URL", async () => {
    const { deps, cookie } = await withSession();
    const res = makeRes();
    await makeContinueEndpoint(deps)(fakeReq({ url: "/auth/continue", cookie }), res.res);

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/?token=launch-token");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("falls back to the bare root when the bridge has nothing to say", async () => {
    const missing = await withSession({ bridge: () => Promise.resolve(undefined) });
    const missingRes = makeRes();
    await makeContinueEndpoint(missing.deps)(
      fakeReq({ url: "/auth/continue", cookie: missing.cookie }),
      missingRes.res,
    );
    expect(missingRes.headers["location"]).toBe("/");

    const absent = await withSession({ bridge: undefined });
    const absentRes = makeRes();
    await makeContinueEndpoint(absent.deps)(
      fakeReq({ url: "/auth/continue", cookie: absent.cookie }),
      absentRes.res,
    );
    expect(absentRes.headers["location"]).toBe("/");
  });

  it("falls back to the bare root when the bridge throws or returns an unsafe target", async () => {
    const thrown = await withSession({ bridge: () => Promise.reject(new Error("boom")) });
    const thrownRes = makeRes();
    await makeContinueEndpoint(thrown.deps)(
      fakeReq({ url: "/auth/continue", cookie: thrown.cookie }),
      thrownRes.res,
    );
    expect(thrownRes.headers["location"]).toBe("/");

    const unsafe = await withSession({ bridge: () => Promise.resolve("//evil.example") });
    const unsafeRes = makeRes();
    await makeContinueEndpoint(unsafe.deps)(
      fakeReq({ url: "/auth/continue", cookie: unsafe.cookie }),
      unsafeRes.res,
    );
    expect(unsafeRes.headers["location"]).toBe("/");
  });

  it("requires a session and never echoes the query", async () => {
    const deps = harness();
    const noCookie = makeRes();
    await makeContinueEndpoint(deps)(
      fakeReq({ url: "/auth/continue?next=//evil.example" }),
      noCookie.res,
    );
    expect(noCookie.status).toBe(302);
    expect(noCookie.headers["location"]).toBe(LOGIN_REDIRECT);

    const unknownCookie = makeRes();
    await makeContinueEndpoint(deps)(
      fakeReq({ url: "/auth/continue", cookie: "dsh_auth=missing" }),
      unknownCookie.res,
    );
    expect(unknownCookie.headers["location"]).toBe(LOGIN_REDIRECT);

    const noStore = makeRes();
    await makeContinueEndpoint(harness({ sessions: () => undefined }))(
      fakeReq({ url: "/auth/continue" }),
      noStore.res,
    );
    expect(noStore.headers["location"]).toBe(LOGIN_REDIRECT);
    expect(noStore.headers["cache-control"]).toBe("no-store");
    expect(noStore.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("answers 405 for any non-GET method", async () => {
    const { deps, cookie } = await withSession();
    const res = makeRes();
    await makeContinueEndpoint(deps)(
      fakeReq({ method: "POST", url: "/auth/continue", cookie }),
      res.res,
    );
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /auth/continue: bootstrap sessions", () => {
  it("refuses a bootstrap session instead of relying on the root bounce", async () => {
    const store = new SessionStore(new MemTable());
    const issued = await store.create("bootstrap", 60_000, "bootstrap");
    const res = makeRes();
    await makeContinueEndpoint(harness({ sessions: () => store }))(
      fakeReq({ url: "/auth/continue", cookie: `dsh_auth=${issued.token}` }),
      res.res,
    );
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(LOGIN_REDIRECT);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
