import { describe, expect, it } from "vitest";
import { parseProxyArgs } from "./proxy-cli.js";

const env: Record<string, string | undefined> = {};

describe("parseProxyArgs", () => {
  it("applies defaults", () => {
    const { options } = parseProxyArgs([], env);
    expect(options.listen).toBe("127.0.0.1:8443");
    expect(options.target).toBe("https://dsh.example.com");
    expect(options.stripSecureCookie).toBe(true);
    expect(options.markProxy).toBe(false);
    expect(options.localToken).toBe("");
    expect(options.unsafePlainTarget).toBe(false);
  });

  it("parses explicit flags", () => {
    const { options } = parseProxyArgs(
      [
        "--listen",
        "127.0.0.1:9000",
        "--target",
        "https://example.com",
        "--no-strip-secure-cookie",
        "--mark-proxy",
        "--unsafe-plain-target",
      ],
      env,
    );
    expect(options.listen).toBe("127.0.0.1:9000");
    expect(options.target).toBe("https://example.com");
    expect(options.stripSecureCookie).toBe(false);
    expect(options.markProxy).toBe(true);
    expect(options.unsafePlainTarget).toBe(true);
  });

  it("resolves --local-token-env from the environment", () => {
    const { options } = parseProxyArgs(["--local-token-env", "DSH_PROXY_TOKEN"], {
      DSH_PROXY_TOKEN: "s3cret",
    });
    expect(options.localToken).toBe("s3cret");
  });

  it("throws when --local-token-env has no value or the variable is unset", () => {
    expect(() => parseProxyArgs(["--local-token-env"], env)).toThrow(/requires a variable name/);
    expect(() => parseProxyArgs(["--local-token-env", "MISSING_VAR"], env)).toThrow(/is not set/);
    expect(() => parseProxyArgs(["--local-token-env", "MISSING_VAR"], { MISSING_VAR: "" })).toThrow(
      /is not set/,
    );
  });

  it("throws when a value flag is missing its value", () => {
    expect(() => parseProxyArgs(["--listen"], env)).toThrow(/requires a value/);
    expect(() => parseProxyArgs(["--target", "--mark-proxy"], env)).toThrow(/requires a value/);
  });
});
