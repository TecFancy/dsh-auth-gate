import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";
import { digestToken, type IssuedSession } from "./session/index.js";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function mountStack(root: string): Promise<{ ctx: Context; fibers: Fiber[] }> {
  const ctx = new Context();
  const fibers: Fiber[] = [];
  fibers.push(await ctx.plugin(Storage));
  fibers.push(
    await ctx.plugin(
      {
        name: storageJson.name,
        inject: storageJson.inject,
        apply: storageJson.apply,
        Config: storageJson.Config,
      },
      { root },
    ),
  );
  fibers.push(
    await ctx.plugin(
      {
        name: storageDomain.name,
        inject: storageDomain.inject,
        apply: storageDomain.apply,
        Config: storageDomain.Config,
      },
      { backend: "json" },
    ),
  );
  fibers.push(await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 }));
  fibers.push(await ctx.plugin({ name, inject, apply, Config }, {} as AuthConfig));
  return { ctx, fibers };
}

async function unmountStack(fibers: Fiber[]): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
}

describe("integration: real storage stack persistence", () => {
  it("persists sessions across a domain reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-auth-"));
    let issued: IssuedSession | undefined;
    try {
      const first = await mountStack(root);
      try {
        const auth1 = first.ctx.get("auth");
        await waitFor(() => auth1?.sessions !== undefined);
        issued = await auth1!.sessions!.create("token", 60_000);
        expect(auth1!.sessions!.getByToken(issued.token)?.subject).toBe("token");

        // On-disk format (docs/implemented/impl-m1.md §2.2): unit header + tables map.
        const doc = JSON.parse(readFileSync(join(root, "dsh_auth_sessions.json"), "utf8")) as {
          unit: { name: string; version: number };
          tables: Record<string, Record<string, unknown>>;
        };
        expect(doc.unit.name).toBe("dsh_auth_sessions");
        expect(doc.tables["sessions"]?.[digestToken(issued.token)]).toBeDefined();
      } finally {
        await unmountStack(first.fibers);
      }

      const second = await mountStack(root);
      try {
        const auth2 = second.ctx.get("auth");
        await waitFor(() => auth2?.sessions !== undefined);
        const restored = auth2!.sessions!.getByToken(issued.token);
        expect(restored?.subject).toBe("token");
        expect(restored?.expiresAt).toBe(issued.session.expiresAt);
      } finally {
        await unmountStack(second.fibers);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
