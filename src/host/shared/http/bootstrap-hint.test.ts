import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { bootstrapRedirectPath, singleTokenParam } from "./bootstrap-hint.js";

function req(url: string, method = "GET"): IncomingMessage {
  return { method, url, headers: {} } as IncomingMessage;
}

describe("bootstrapRedirectPath", () => {
  it("maps a bare token launch URL to the bootstrap endpoint", () => {
    expect(bootstrapRedirectPath(req("/?token=launch"))).toBe("/auth/bootstrap?token=launch");
  });

  it("keeps the token verbatim and re-encodes it in the location", () => {
    // 查询串里的 `+` 解码成空格；位置里重新编码后必须还是同一个值，不能再变一次。
    expect(bootstrapRedirectPath(req("/?token=a+b/c="))).toBe(
      `/auth/bootstrap?token=${encodeURIComponent("a b/c=")}`,
    );
    expect(bootstrapRedirectPath(req("/?token=a%20b"))).toBe("/auth/bootstrap?token=a%20b");
    expect(bootstrapRedirectPath(req("/?token=A%2FB_9-"))).toBe("/auth/bootstrap?token=A%2FB_9-");
  });

  it("ignores everything that is not the bare root with a single token", () => {
    expect(bootstrapRedirectPath(req("/"))).toBeUndefined();
    expect(bootstrapRedirectPath(req("/index.html?token=x"))).toBeUndefined();
    expect(bootstrapRedirectPath(req("/api/x?token=x"))).toBeUndefined();
    expect(bootstrapRedirectPath(req("/?token=a&token=b"))).toBeUndefined();
    expect(bootstrapRedirectPath(req("/?token="))).toBeUndefined();
    expect(bootstrapRedirectPath(req("/?token=%20%20"))).toBeUndefined();
    expect(bootstrapRedirectPath(req("/?other=x"))).toBeUndefined();
  });

  it("requires GET", () => {
    expect(bootstrapRedirectPath(req("/?token=x", "POST"))).toBeUndefined();
    expect(bootstrapRedirectPath(req("/?token=x", "HEAD"))).toBeUndefined();
  });

  it("tolerates a missing url", () => {
    const missing = { method: "GET", headers: {} } as IncomingMessage;
    expect(bootstrapRedirectPath(missing)).toBeUndefined();
  });
});

describe("singleTokenParam", () => {
  it("accepts exactly one non-blank value", () => {
    expect(singleTokenParam(new URLSearchParams("token=x"))).toBe("x");
    expect(singleTokenParam(new URLSearchParams("token=%20x%20"))).toBe(" x ");
  });

  it("rejects zero, several and blank values", () => {
    expect(singleTokenParam(new URLSearchParams(""))).toBeUndefined();
    expect(singleTokenParam(new URLSearchParams("token=a&token=b"))).toBeUndefined();
    expect(singleTokenParam(new URLSearchParams("token="))).toBeUndefined();
    expect(singleTokenParam(new URLSearchParams("token=%09"))).toBeUndefined();
  });
});
