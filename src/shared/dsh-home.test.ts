import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dshHomeDir } from "./dsh-home.js";

describe("dshHomeDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses DSH_HOME when set", () => {
    vi.stubEnv("DSH_HOME", "/srv/dsh");
    expect(dshHomeDir()).toBe("/srv/dsh");
  });

  it("falls back to ~/.dsh when DSH_HOME is unset", () => {
    vi.stubEnv("DSH_HOME", undefined);
    expect(dshHomeDir()).toBe(path.join(os.homedir(), ".dsh"));
  });
});
