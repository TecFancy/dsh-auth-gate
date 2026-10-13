import { describe, expect, it } from "vitest";
import { checkRequestOrigin, type OriginCheckRequest } from "./origin.js";

function req(headers: Record<string, string | string[]>, encrypted = false): OriginCheckRequest {
  return { headers, socket: { encrypted } };
}

const HOST = "dsh.example.com";
const HTTPS = `https://${HOST}`;

describe("checkRequestOrigin: Sec-Fetch-Site channel", () => {
  it("allows Sec-Fetch-Site: same-origin without any Origin header", () => {
    expect(checkRequestOrigin(req({ "sec-fetch-site": "same-origin" }), HOST)).toEqual({
      ok: true,
      source: "sec-fetch-site",
    });
  });

  it("normalizes case and surrounding whitespace of Sec-Fetch-Site", () => {
    expect(checkRequestOrigin(req({ "sec-fetch-site": " Same-Origin " }), HOST).ok).toBe(true);
  });

  it("accepts a valid Origin even when Sec-Fetch-Site says cross-site (either channel passes)", () => {
    const verdict = checkRequestOrigin(
      req({ "sec-fetch-site": "cross-site", origin: HTTPS }),
      HTTPS,
    );
    expect(verdict).toEqual({ ok: true, source: "origin" });
  });
});

describe("checkRequestOrigin: Origin channel", () => {
  it("allows an Origin that exactly matches the configured https publicHost", () => {
    expect(checkRequestOrigin(req({ origin: HTTPS }), HTTPS)).toEqual({
      ok: true,
      source: "origin",
    });
  });

  it("derives the scheme from the transport when publicHost has no scheme (plain socket)", () => {
    expect(checkRequestOrigin(req({ origin: "http://127.0.0.1:3086" }), "127.0.0.1:3086")).toEqual({
      ok: true,
      source: "origin",
    });
    expect(checkRequestOrigin(req({ origin: "https://127.0.0.1:3086" }), "127.0.0.1:3086").ok).toBe(
      false,
    );
  });

  it("derives the scheme from the transport when publicHost has no scheme (TLS socket)", () => {
    expect(checkRequestOrigin(req({ origin: HTTPS }, true), HOST).ok).toBe(true);
    expect(checkRequestOrigin(req({ origin: `http://${HOST}` }, true), HOST).ok).toBe(false);
  });

  it("ignores a spoofed Host header when publicHost is configured", () => {
    const verdict = checkRequestOrigin(req({ origin: HTTPS, host: "evil.example" }), HTTPS);
    expect(verdict).toEqual({ ok: true, source: "origin" });
  });

  it("tolerates a trailing slash and duplicate header values", () => {
    expect(checkRequestOrigin(req({ origin: `${HTTPS}/` }), HTTPS).ok).toBe(true);
    expect(checkRequestOrigin(req({ origin: [HTTPS] }), HTTPS).ok).toBe(true);
  });

  it("treats a publicHost given as a URL as its origin", () => {
    expect(checkRequestOrigin(req({ origin: HTTPS }), `${HTTPS}/path`).ok).toBe(true);
  });
});

describe("checkRequestOrigin: rejections", () => {
  it("never falls back to the Host header when publicHost is unconfigured", () => {
    const verdict = checkRequestOrigin(req({ origin: `http://${HOST}`, host: HOST }), "");
    expect(verdict).toEqual({
      ok: false,
      reason: "bad_origin",
      detail: "public-host-unconfigured",
    });
  });

  it("rejects a literal null origin", () => {
    expect(checkRequestOrigin(req({ origin: "null" }), HTTPS)).toEqual({
      ok: false,
      reason: "bad_origin",
      detail: "null",
    });
  });

  it("rejects multiple origins instead of matching any of them", () => {
    const verdict = checkRequestOrigin(req({ origin: `${HTTPS}, https://evil.example` }), HTTPS);
    expect(verdict).toEqual({ ok: false, reason: "bad_origin", detail: "multiple" });
  });

  it.each([
    ["not a url", "malformed"],
    [`${HTTPS}/auth/password`, "malformed"],
    [`https://user@${HOST}`, "malformed"],
    [`${HTTPS}?x=1`, "malformed"],
    [`${HTTPS}#frag`, "malformed"],
    [`//${HOST}`, "malformed"],
  ])("rejects malformed Origin %j", (origin, detail) => {
    expect(checkRequestOrigin(req({ origin }), HTTPS)).toEqual({
      ok: false,
      reason: "bad_origin",
      detail,
    });
  });

  it.each([
    `https://sub.${HOST}`,
    `https://${HOST}.evil.example`,
    `https://${HOST}:8443`,
    `http://${HOST}`,
  ])("rejects non-identical origin %j", (origin) => {
    expect(checkRequestOrigin(req({ origin }), HTTPS)).toEqual({
      ok: false,
      reason: "bad_origin",
      detail: "mismatch",
    });
  });

  it("fails closed when both headers are missing", () => {
    expect(checkRequestOrigin(req({}), HTTPS)).toEqual({
      ok: false,
      reason: "bad_origin",
      detail: "missing",
    });
  });

  it.each(["same-site", "cross-site", "none"])(
    "does not treat Sec-Fetch-Site %j as same-origin",
    (value) => {
      expect(checkRequestOrigin(req({ "sec-fetch-site": value }), HTTPS)).toEqual({
        ok: false,
        reason: "bad_origin",
        detail: "missing",
      });
    },
  );
});
