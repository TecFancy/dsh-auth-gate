import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { noopGate } from "./gate.js";

describe("noopGate", () => {
  it("allows every guarded entry class", async () => {
    const req = {} as unknown as IncomingMessage;
    expect(await noopGate.decide(req, "exact", "/")).toBe("allow");
    expect(await noopGate.decide(req, "prefix", "/api")).toBe("allow");
    expect(await noopGate.decide(req, "upgrade", "/api/events.host")).toBe("allow");
    expect(await noopGate.decide(req, "fallback", "/")).toBe("allow");
  });
});
