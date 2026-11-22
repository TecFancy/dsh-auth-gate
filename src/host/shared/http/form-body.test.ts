import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { FORM_BODY_LIMIT, formField, parseFormBody } from "./form-body.js";

function fakeReq(options: {
  contentType?: string;
  chunks: Buffer[];
  destroyCalls?: () => void;
}): IncomingMessage {
  const req = {
    headers: options.contentType === undefined ? {} : { "content-type": options.contentType },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      for (const chunk of options.chunks) yield chunk;
    },
    destroy: () => options.destroyCalls?.(),
  } as unknown as IncomingMessage;
  return req;
}

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number }).status;
}

describe("parseFormBody", () => {
  it("parses a urlencoded body", async () => {
    const req = fakeReq({
      contentType: "application/x-www-form-urlencoded",
      chunks: [Buffer.from("token=x&next=%2F")],
    });
    const params = await parseFormBody(req);
    expect(params.get("token")).toBe("x");
    expect(params.get("next")).toBe("/");
  });

  it("rejects a missing content-type with 415", async () => {
    const req = fakeReq({ chunks: [Buffer.from("token=x")] });
    await expect(parseFormBody(req)).rejects.toSatisfy((error) => statusOf(error) === 415);
  });

  it("rejects a wrong content-type with 415", async () => {
    const req = fakeReq({ contentType: "text/plain", chunks: [Buffer.from("token=x")] });
    await expect(parseFormBody(req)).rejects.toSatisfy((error) => statusOf(error) === 415);
  });

  it("accepts a content-type with a charset parameter", async () => {
    const req = fakeReq({
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
      chunks: [Buffer.from("token=x")],
    });
    expect((await parseFormBody(req)).get("token")).toBe("x");
  });

  it("rejects a lookalike media type with 415 (exact token match)", async () => {
    const req = fakeReq({
      contentType: "application/x-www-form-urlencodedx",
      chunks: [Buffer.from("token=x")],
    });
    await expect(parseFormBody(req)).rejects.toSatisfy((error) => statusOf(error) === 415);
  });

  it("rejects an oversized body with 413 without destroying the request", async () => {
    let destroyed = 0;
    const req = fakeReq({
      contentType: "application/x-www-form-urlencoded",
      chunks: [Buffer.alloc(FORM_BODY_LIMIT + 1, 0x61)],
      destroyCalls: () => {
        destroyed += 1;
      },
    });
    await expect(parseFormBody(req)).rejects.toSatisfy((error) => statusOf(error) === 413);
    expect(destroyed).toBe(0);
  });
});

describe("formField", () => {
  interface SampleRequest {
    target: string;
    code?: string;
  }

  it("returns the raw value, untrimmed", () => {
    const params = new URLSearchParams("target=%20alice%20&code=123456");
    expect(formField<SampleRequest>(params, "target")).toBe(" alice ");
    expect(formField<SampleRequest>(params, "code")).toBe("123456");
  });

  it("returns an empty string for an absent field", () => {
    expect(formField<SampleRequest>(new URLSearchParams(""), "code")).toBe("");
  });
});

describe("parseFormBody over a real HTTP connection (G13)", () => {
  it("makes the 413 client-visible instead of resetting the socket", async () => {
    // 真实 node:http 连接（不是同步生成器夹具）：超限后服务器写 413 + connection: close 并结束，
    // 客户端必须读到响应本身；若连接被重置，fetch 会 reject（ECONNRESET）而不是 resolve 413。
    const server = createServer((req, res) => {
      void (async () => {
        try {
          await parseFormBody(req);
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
        } catch (error) {
          const status = statusOf(error) ?? 500;
          res.setHeader("cache-control", "no-store");
          if (status === 413) res.setHeader("connection", "close");
          res.writeHead(status, { "content-type": "text/plain" });
          res.end(error instanceof Error ? error.message : "bad request");
        }
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("expected a TCP address");
      const response = await fetch(`http://127.0.0.1:${address.port}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "a".repeat(FORM_BODY_LIMIT + 1),
      });
      expect(response.status).toBe(413);
      await expect(response.text()).resolves.toBe("request body too large");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });
});
