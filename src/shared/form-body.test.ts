import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { FORM_BODY_LIMIT, parseFormBody } from "./form-body.js";

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
