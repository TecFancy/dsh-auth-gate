import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Gate } from "./gate.js";
import {
  guardUpgrade,
  wrapServer,
  type GuardLog,
  type WrappableRoute,
  type WrappableServer,
  type WrappableUpgradeRoute,
} from "./guard.js";

const log: GuardLog = { error: () => undefined };

interface SocketState {
  written: string | undefined;
  ended: string | undefined;
  destroyed: boolean | undefined;
  errorListeners: number;
}
type FakeSocket = Duplex & { state: SocketState };

function makeFakeServer(): WrappableServer {
  const exact = new Map<string, WrappableRoute>();
  const prefixes = new Map<string, WrappableRoute>();
  const upgrades = new Map<string, WrappableUpgradeRoute>();
  const server: WrappableServer = {
    exact,
    prefixes,
    upgrades,
    fallback: undefined,
    register(route) {
      exact.set(route.path, route);
      return () => exact.delete(route.path);
    },
    registerUpgrade(route) {
      upgrades.set(route.path, route);
      return () => upgrades.delete(route.path);
    },
    registerFallback(handler) {
      server.fallback = handler;
      return () => {
        server.fallback = undefined;
      };
    },
  };
  return server;
}

function makeReq(url: string): IncomingMessage {
  return { url, method: "GET", headers: {} } as unknown as IncomingMessage;
}

function makeSocket(): FakeSocket {
  const state: SocketState = {
    written: undefined,
    ended: undefined,
    destroyed: undefined,
    errorListeners: 0,
  };
  const socket = {
    state,
    write(data: string) {
      state.written = String(data);
    },
    end(data?: string) {
      state.ended = data;
    },
    on(event: string) {
      if (event === "error") state.errorListeners += 1;
      return socket;
    },
    destroy() {
      state.destroyed = true;
    },
  } as unknown as FakeSocket;
  return socket;
}

describe("guardUpgrade + denyUpgrade (G4)", () => {
  it("rejects upgrades before negotiation and allows them through", async () => {
    const server = makeFakeServer();
    let calls = 0;
    server.upgrades.set("/api/events.host", {
      path: "/api/events.host",
      handler: () => {
        calls += 1;
      },
    });
    let gate: Gate = { decide: () => "deny" };
    wrapServer(server, () => gate, log);
    const handler = server.upgrades.get("/api/events.host")!.handler;

    const socket = makeSocket();
    await handler(makeReq("/api/events.host"), socket, Buffer.alloc(0));
    expect(socket.state.ended).toMatch(/^HTTP\/1\.1 401 Unauthorized/);
    // 优雅结束：end() 让 401 响应行真的到达对端，destroy() 会把还没刷出的数据丢掉。
    expect(socket.state.destroyed).toBeUndefined();
    // 客户端可能已经重置连接：先挂 no-op 'error' 监听器，避免未捕获的 'error' 事件。
    expect(socket.state.errorListeners).toBe(1);
    expect(calls).toBe(0);

    gate = { decide: () => "allow" };
    const socket2 = makeSocket();
    await handler(makeReq("/api/events.host"), socket2, Buffer.alloc(0));
    expect(calls).toBe(1);
    expect(socket2.state.ended).toBeUndefined();
  });

  it("denies with 401 instead of throwing when the gate throws (G4)", async () => {
    let called = 0;
    const guarded = guardUpgrade(
      () => ({
        decide: () => {
          throw new Error("gate boom");
        },
      }),
      () => {
        called += 1;
      },
    );
    const socket = makeSocket();
    await expect(guarded(makeReq("/events"), socket, Buffer.alloc(0))).resolves.toBeUndefined();
    expect(socket.state.ended).toMatch(/^HTTP\/1\.1 401 Unauthorized/);
    expect(socket.state.errorListeners).toBe(1);
    expect(called).toBe(0);
  });
});
