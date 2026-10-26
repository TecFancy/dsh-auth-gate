import { describe, expect, it } from "vitest";
import { makeConfiguredProbe, type ConfiguredProbeDeps } from "./probe.js";

function deps(overrides: Partial<ConfiguredProbeDeps> = {}): ConfiguredProbeDeps {
  return {
    mode: "token",
    resolveToken: () => Promise.resolve(undefined),
    usersPath: "/nonexistent/users.yaml",
    markedConfigured: { value: false },
    ...overrides,
  };
}

describe("makeConfiguredProbe (token mode)", () => {
  it("reads a missing or empty credential as unconfigured", async () => {
    const missing = makeConfiguredProbe(deps());
    expect(await missing.state()).toBe("unconfigured");

    const empty = makeConfiguredProbe(deps({ resolveToken: () => Promise.resolve("") }));
    expect(await empty.state()).toBe("unconfigured");
  });

  it("reads a non-empty credential as configured", async () => {
    const probe = makeConfiguredProbe(deps({ resolveToken: () => Promise.resolve("live-token") }));
    expect(await probe.state()).toBe("configured");
  });

  it("reads a throwing resolver or a missing resolver as unknown", async () => {
    const throwing = makeConfiguredProbe(
      deps({ resolveToken: () => Promise.reject(new Error("credentials gone")) }),
    );
    expect(await throwing.state()).toBe("unknown");

    const absent = makeConfiguredProbe(deps({ resolveToken: undefined }));
    expect(await absent.state()).toBe("unknown");
  });

  it("answers configured forever once the wizard marks the instance", async () => {
    const probe = makeConfiguredProbe(deps());
    expect(await probe.state()).toBe("unconfigured");
    probe.markConfigured();
    expect(await probe.state()).toBe("configured");
    // 即使解析器此后抛错，标记也不回退：引导窗口一旦关闭就不再打开。
    const marked = makeConfiguredProbe({
      ...deps({ resolveToken: () => Promise.reject(new Error("boom")) }),
      markedConfigured: { value: true },
    });
    expect(await marked.state()).toBe("configured");
  });

  it("re-reads the credential on every call, never caching the answer", async () => {
    const state: { value: string | undefined } = { value: undefined };
    const probe = makeConfiguredProbe(deps({ resolveToken: () => Promise.resolve(state.value) }));
    expect(await probe.state()).toBe("unconfigured");
    state.value = "written-by-the-cli";
    expect(await probe.state()).toBe("configured");
  });
});
