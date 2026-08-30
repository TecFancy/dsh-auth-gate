import { describe, expect, it } from "vitest";
import { parseCookieHeader } from "./cookie.js";

describe("parseCookieHeader", () => {
  it("returns undefined without a header", () => {
    expect(parseCookieHeader(undefined, "dsh_auth")).toBeUndefined();
  });

  it("parses a single cookie", () => {
    expect(parseCookieHeader("dsh_auth=tok123", "dsh_auth")).toBe("tok123");
  });

  it("takes the first of several cookies with the same name", () => {
    expect(parseCookieHeader("dsh_auth=first; dsh_auth=second", "dsh_auth")).toBe("first");
  });

  it("keeps values containing an equals sign", () => {
    expect(parseCookieHeader("dsh_auth=a=b=c", "dsh_auth")).toBe("a=b=c");
  });

  it("tolerates spaces around separators and keeps quoted values verbatim", () => {
    expect(parseCookieHeader('other=1;  dsh_auth="tok" ; x=2', "dsh_auth")).toBe('"tok"');
  });

  it("returns undefined when the name is absent", () => {
    expect(parseCookieHeader("other=1; x=2", "dsh_auth")).toBeUndefined();
  });

  it("returns an empty string for an empty value", () => {
    expect(parseCookieHeader("dsh_auth=", "dsh_auth")).toBe("");
  });

  it("skips segments without an equals sign", () => {
    expect(parseCookieHeader("noop; dsh_auth=tok", "dsh_auth")).toBe("tok");
  });
});
