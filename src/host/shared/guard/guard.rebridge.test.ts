/**
 * 放行后重铸钩子：`AdmitRebridge` 只在门给出 `allow` 之后询问，给出站内 Location 时守卫 302
 * 到它、不调用原入口；钩子缺失/抛错/给出站外地址时一律照常放行。
 *
 * 这些断言钉住三件容易写错的事：拒绝分支上不询问、跨站弹回排在重铸之前、以及钩子坏掉时
 * 不能把一次已放行的请求变成错误。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import type { AdmitRebridge } from "./rebridge.js";
import { guardHttp, guardUpgrade } from "./guard.js";
import { guardResource } from "./resource.js";

const allowGate = (): Gate => ({ decide: () => "allow" });
const denyGate = (): Gate => ({ decide: () => "deny" });

interface Recorded {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function makeReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, method: "GET", headers } as unknown as IncomingMessage;
}

function makeRes(record: Recorded): ServerResponse {
  return {
    headersSent: false,
    setHeader: () => undefined,
    writeHead: (status: number, headers?: Record<string, string>) => {
      record.status = status;
      record.headers = headers ?? {};
    },
    end: (body?: string) => {
      record.body = body ?? "";
    },
  } as unknown as ServerResponse;
}

function newRecord(): Recorded {
  return { status: 0, headers: {}, body: "" };
}

/** 固定返回某个 Location 的钩子，并记录被问了几次。 */
function fixedRebridge(location: string | undefined): {
  count: () => number;
  hook: AdmitRebridge;
} {
  let calls = 0;
  return {
    count: () => calls,
    hook: () => {
      calls += 1;
      return location === undefined ? undefined : { location };
    },
  };
}

describe("放行后重铸：handler 入口的 302", () => {
  it("钩子给出站内 Location 时 302 到它，不调用原 handler", async () => {
    const record = newRecord();
    let handled = 0;
    const rebridge = fixedRebridge("/?token=abc");
    const guarded = guardHttp(
      allowGate,
      "fallback",
      () => {
        handled += 1;
      },
      undefined,
      rebridge.hook,
    );
    await guarded(makeReq("/"), makeRes(record));
    expect(record.status).toBe(302);
    expect(record.headers["location"]).toBe("/?token=abc");
    expect(record.headers["cache-control"]).toBe("no-store");
    expect(record.headers["referrer-policy"]).toBe("no-referrer");
    expect(handled).toBe(0);
    expect(rebridge.count()).toBe(1);
  });

  it("钩子返回 undefined 时照常调用原 handler", async () => {
    const record = newRecord();
    let handled = 0;
    const guarded = guardHttp(
      allowGate,
      "fallback",
      () => {
        handled += 1;
      },
      undefined,
      fixedRebridge(undefined).hook,
    );
    await guarded(makeReq("/"), makeRes(record));
    expect(handled).toBe(1);
    expect(record.status).toBe(0);
  });
});

describe("放行后重铸：handler 入口的降级", () => {
  it("拒绝分支上不询问钩子", async () => {
    const record = newRecord();
    const rebridge = fixedRebridge("/?token=abc");
    const guarded = guardHttp(denyGate, "fallback", () => undefined, undefined, rebridge.hook);
    await guarded(makeReq("/"), makeRes(record));
    expect(rebridge.count()).toBe(0);
    expect(record.status).toBe(401);
  });

  it("钩子抛错时照常放行，不把已放行的请求变成错误", async () => {
    const record = newRecord();
    let handled = 0;
    const guarded = guardHttp(
      allowGate,
      "fallback",
      () => {
        handled += 1;
      },
      undefined,
      () => {
        throw new Error("boom");
      },
    );
    await guarded(makeReq("/"), makeRes(record));
    expect(handled).toBe(1);
    expect(record.status).toBe(0);
  });

  it("钩子给出站外或带控制符的 Location 时丢弃它、照常放行", async () => {
    for (const location of ["//evil.example", "https://evil.example/", "/\t/evil.example"]) {
      const record = newRecord();
      let handled = 0;
      const guarded = guardHttp(
        allowGate,
        "fallback",
        () => {
          handled += 1;
        },
        undefined,
        () => ({ location }),
      );
      await guarded(makeReq("/"), makeRes(record));
      expect(handled, location).toBe(1);
      expect(record.status, location).toBe(0);
    }
  });

  it("随 302 下发钩子给的 Set-Cookie", async () => {
    const record = newRecord();
    const guarded = guardHttp(
      allowGate,
      "fallback",
      () => undefined,
      undefined,
      () => ({
        location: "/?token=abc",
        setCookie: "dsh_auth_rebridge=1; Max-Age=60; Path=/; HttpOnly; SameSite=Lax",
      }),
    );
    await guarded(makeReq("/"), makeRes(record));
    expect(record.headers["set-cookie"]).toBe(
      "dsh_auth_rebridge=1; Max-Age=60; Path=/; HttpOnly; SameSite=Lax",
    );
  });
});

describe("放行后重铸：顺序与入口覆盖", () => {
  it("跨站弹回排在重铸之前：跨站导航先拿弹回页，不重铸", async () => {
    const record = newRecord();
    const rebridge = fixedRebridge("/?token=abc");
    const guarded = guardHttp(allowGate, "fallback", () => undefined, undefined, rebridge.hook);
    await guarded(
      makeReq("/", { "sec-fetch-site": "cross-site", "sec-fetch-dest": "document" }),
      makeRes(record),
    );
    // 弹回页是 200 常量页；若先重铸会变成 302，而新签发的 Strict cookie 在跨站链上照样不发。
    expect(record.status).toBe(200);
    expect(record.body).toContain("location.replace(location.href)");
    expect(rebridge.count()).toBe(0);
  });

  it("upgrade 入口不询问钩子（握手没法用重定向修复）", async () => {
    const rebridge = fixedRebridge("/?token=abc");
    let upgraded = 0;
    const guarded = guardUpgrade(allowGate, () => {
      upgraded += 1;
    });
    const socket = { write: () => undefined, destroy: () => undefined } as unknown as Duplex;
    await guarded(makeReq("/events"), socket, Buffer.alloc(0));
    expect(upgraded).toBe(1);
    expect(rebridge.count()).toBe(0);
  });
});

describe("放行后重铸：resource 入口", () => {
  it("钩子给出 Location 时回 302 Response，不调用原 resource", async () => {
    let called = 0;
    const guarded = guardResource(
      allowGate,
      "fallback",
      () => {
        called += 1;
        return Promise.resolve(new Response("index", { status: 200 }));
      },
      undefined,
      () => ({ location: "/?token=abc" }),
    );
    const response = await guarded(new Request("http://127.0.0.1:3080/"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/?token=abc");
    expect(called).toBe(0);
  });

  it("HEAD 的重铸响应不带正文", async () => {
    const guarded = guardResource(
      allowGate,
      "fallback",
      () => Promise.resolve(new Response("index", { status: 200 })),
      undefined,
      () => ({ location: "/?token=abc" }),
    );
    const response = await guarded(new Request("http://127.0.0.1:3080/", { method: "HEAD" }));
    expect(response.status).toBe(302);
    expect(await response.text()).toBe("");
  });
});
