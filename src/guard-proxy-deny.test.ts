import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Gate } from "./gate/index.js";
import { guardHttp, guardUpgrade } from "./gate/index.js";

interface ResState {
  status: number | undefined;
  body: string | undefined;
}
type FakeRes = ServerResponse & { state: ResState };

interface SocketState {
  written: string | undefined;
  destroyed: boolean | undefined;
}
type FakeSocket = Duplex & { state: SocketState };

function makeReq(url: string, method = "GET", extra?: Record<string, string>): IncomingMessage {
  return { url, method, headers: extra ?? {} } as unknown as IncomingMessage;
}

function makeRes(): FakeRes {
  const state: ResState = { status: undefined, body: undefined };
  return {
    state,
    headersSent: false,
    setHeader() {
      /* 不关心 */
    },
    writeHead(status: number) {
      state.status = status;
    },
    end(body?: string) {
      state.body = body;
    },
  } as unknown as FakeRes;
}

function makeSocket(): FakeSocket {
  const state: SocketState = { written: undefined, destroyed: undefined };
  return {
    state,
    write(data: string) {
      state.written = String(data);
    },
    destroy() {
      state.destroyed = true;
    },
  } as unknown as FakeSocket;
}

describe("proxy marker deny-list", () => {
  const gate: Gate = { decide: () => "allow" };

  it("forbids marked requests to host-native and discover methods", async () => {
    for (const method of [
      "host.pickDirectory",
      "host.openPath",
      "settings.openDocument",
      "llm.discoverModels",
    ]) {
      let called = false;
      const guarded = guardHttp(
        () => gate,
        "prefix",
        () => {
          called = true;
        },
      );
      const res = makeRes();
      await guarded(makeReq(`/api/${method}`, "POST", { "x-dsh-proxy": "1" }), res);
      expect(res.state.status).toBe(403);
      expect(res.state.body).toBe("forbidden");
      expect(called).toBe(false);
    }
  });

  it("lets marked requests through for the config plane", async () => {
    let calls = 0;
    const guarded = guardHttp(
      () => gate,
      "prefix",
      () => {
        calls += 1;
      },
    );
    const res = makeRes();
    await guarded(makeReq("/api/settings.describe", "POST", { "x-dsh-proxy": "1" }), res);
    expect(res.state.status).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("ignores unmarked requests and non-/api paths", async () => {
    let calls = 0;
    const guarded = guardHttp(
      () => gate,
      "prefix",
      () => {
        calls += 1;
      },
    );
    await guarded(makeReq("/api/host.openPath", "POST"), makeRes());
    await guarded(makeReq("/assets/main.js", "GET", { "x-dsh-proxy": "1" }), makeRes());
    expect(calls).toBe(2);
  });

  it("does not deny WebSocket upgrades (events channels are not in the list)", async () => {
    let calls = 0;
    const guarded = guardUpgrade(
      () => gate,
      () => {
        calls += 1;
      },
    );
    const socket = makeSocket();
    await guarded(
      makeReq("/api/events.mux", "GET", { "x-dsh-proxy": "1" }),
      socket,
      Buffer.alloc(0),
    );
    expect(calls).toBe(1);
    expect(socket.state.destroyed).toBeUndefined();
  });
});
