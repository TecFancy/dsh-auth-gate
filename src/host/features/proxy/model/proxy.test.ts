import { createServer as createOriginServer, request, type Server } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProxyServer, validateProxyOptions, type ProxyOptions } from "./proxy.js";

function baseOptions(overrides: Partial<ProxyOptions> = {}): ProxyOptions {
  return {
    listen: "127.0.0.1:0",
    target: "http://127.0.0.1:1",
    stripSecureCookie: true,
    markProxy: false,
    localToken: "",
    unsafePlainTarget: true,
    ...overrides,
  };
}

/** 最小上游：回显请求路径与 `x-dsh-proxy` 头；`/secure` 响应带 Secure cookie。 */
async function startOrigin(): Promise<{ origin: Server; url: string }> {
  const origin = createOriginServer((req, res) => {
    if (req.url === "/secure") {
      res.setHeader("set-cookie", "s=t; HttpOnly; Secure; SameSite=Lax");
      res.end("secure");
      return;
    }
    res.end(`${req.method} ${req.url} proxy=${String(req.headers["x-dsh-proxy"] ?? "none")}`);
  });
  origin.listen(0, "127.0.0.1");
  await once(origin, "listening");
  const address = origin.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { origin, url: `http://127.0.0.1:${String(port)}` };
}

function setCookieList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return value instanceof Array ? value : [value];
}

const UPGRADE_REQUEST =
  "GET /api/events.mux HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: aGVsbG8=\r\nSec-WebSocket-Version: 13\r\n\r\n";

/** 读到首个 HTTP 响应头块（含 `\r\n\r\n`）。 */
function firstUpgradeResponse(socket: ReturnType<typeof connect>): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (data.includes("\r\n\r\n")) {
        socket.off("data", onData);
        resolve(data);
      }
    };
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

/** 向某代理地址发起 WS 升级请求（可附加头），返回 socket 与响应头。 */
async function upgradeThrough(
  url: string,
  extraHeaders = "",
): Promise<{ socket: ReturnType<typeof connect>; head: string }> {
  const sock = connect(Number(url.split(":").pop()), "127.0.0.1");
  const headPromise = firstUpgradeResponse(sock);
  const base = UPGRADE_REQUEST.replace(/\r\n\r\n$/, "");
  sock.write(`${base}\r\n${extraHeaders}\r\n\r\n`);
  const head = await headPromise;
  return { socket: sock, head };
}

/** 启动服务器并返回其地址（127.0.0.1 上的 OS 分配端口）。 */
function listenServer(server: Server): Promise<string> {
  return new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });
}

interface Fixture {
  origin?: Server;
  originUrl: string;
  proxy?: Server;
  proxyUrl: string;
  overrides?: Partial<ProxyOptions>;
}

/** 注册一套"上游 + 代理"的 beforeEach/afterEach，需在 describe 内调用。 */
function proxyHooks(fx: Fixture): void {
  beforeEach(async () => {
    const boot = await startOrigin();
    fx.origin = boot.origin;
    fx.originUrl = boot.url;
    fx.proxy = createProxyServer(baseOptions({ target: boot.url, ...fx.overrides }));
    fx.proxyUrl = await listenServer(fx.proxy);
  });
  afterEach(() => {
    fx.proxy?.close();
    fx.origin?.close();
  });
}

function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; cookie: string[] }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: data,
          cookie: setCookieList(res.headers["set-cookie"]),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("HTTP forwarding basics", () => {
  const fx: Fixture = { originUrl: "", proxyUrl: "" };
  proxyHooks(fx);

  it("passes the request through and replaces the host header", async () => {
    const res = await httpGet(`${fx.proxyUrl}/hello?q=1`, {
      host: "127.0.0.1:x",
      cookie: "dsh_auth=t",
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe("GET /hello?q=1 proxy=none");
  });

  it("strips Secure from set-cookie responses", async () => {
    const res = await httpGet(`${fx.proxyUrl}/secure`);
    expect(res.status).toBe(200);
    expect(res.cookie).toEqual(["s=t; HttpOnly; SameSite=Lax"]);
  });

  it("keeps Secure when stripping is disabled", async () => {
    const keep = createProxyServer(baseOptions({ target: fx.originUrl, stripSecureCookie: false }));
    const url = await listenServer(keep);
    const res = await httpGet(`${url}/secure`);
    expect(res.cookie).toEqual(["s=t; HttpOnly; Secure; SameSite=Lax"]);
    keep.close();
  });
});

describe("HTTP forwarding marker and guards", () => {
  const fx: Fixture = { originUrl: "", proxyUrl: "" };
  proxyHooks(fx);

  it("adds the X-Dsh-Proxy marker when configured", async () => {
    const marked = createProxyServer(baseOptions({ target: fx.originUrl, markProxy: true }));
    const url = await listenServer(marked);
    const res = await httpGet(`${url}/m`);
    expect(res.body).toBe("GET /m proxy=1");
    marked.close();
  });

  it("requires the local token when configured", async () => {
    const guarded = createProxyServer(baseOptions({ target: fx.originUrl, localToken: "secret" }));
    const url = await listenServer(guarded);
    const denied = await httpGet(url);
    expect(denied.status).toBe(401);
    const allowed = await httpGet(url, { authorization: "Bearer secret" });
    expect(allowed.status).toBe(200);
    guarded.close();
  });

  it("answers 502 when the upstream is unreachable", async () => {
    const dead = createProxyServer(baseOptions({ target: "http://127.0.0.1:1" }));
    const url = await listenServer(dead);
    const res = await httpGet(`${url}/x`);
    expect(res.status).toBe(502);
    dead.close();
  });
});

describe("WebSocket upgrade forwarding", () => {
  const fx: Fixture = { originUrl: "", proxyUrl: "" };
  proxyHooks(fx);

  it("tunnels a 101 upgrade and echoes data both ways", async () => {
    let seenProtocol = "";
    let seenExtensions = "";
    fx.origin?.on("upgrade", (req, socket) => {
      seenProtocol = String(req.headers["sec-websocket-protocol"] ?? "");
      seenExtensions = String(req.headers["sec-websocket-extensions"] ?? "");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: echo\r\n\r\n",
      );
      socket.on("data", (chunk) => socket.write(chunk));
    });
    const { socket: sock, head } = await upgradeThrough(
      fx.proxyUrl,
      "Sec-WebSocket-Protocol: chat\r\nSec-WebSocket-Extensions: permessage-deflate",
    );
    expect(head).toMatch(/^HTTP\/1\.1 101/);
    expect(head).toMatch(/sec-websocket-accept:\s*echo/i);
    expect(seenProtocol).toBe("chat");
    expect(seenExtensions).toContain("permessage-deflate");
    const echoed = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("echo timeout")), 2000);
      sock.once("data", (chunk) => {
        clearTimeout(timer);
        resolve(chunk.toString("utf8"));
      });
      sock.write("ping");
    });
    expect(echoed).toBe("ping");
    sock.destroy();
  });

  it("relays a rejected upgrade response (upstream answers non-101)", async () => {
    fx.origin?.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 426 Upgrade Required\r\ncontent-type: text/plain\r\ncontent-length: 2\r\n\r\nno",
      );
    });
    const { socket: sock, head } = await upgradeThrough(fx.proxyUrl);
    expect(head).toMatch(/^HTTP\/1\.1 426/);
    sock.destroy();
  });

  it("rejects the upgrade with 401 when the local token is missing", async () => {
    const guarded = createProxyServer(baseOptions({ target: fx.originUrl, localToken: "secret" }));
    const url = await listenServer(guarded);
    const { socket: sock, head } = await upgradeThrough(url);
    expect(head).toMatch(/^HTTP\/1\.1 401/);
    sock.destroy();
    guarded.close();
  });

  it("allows the upgrade when the local token matches", async () => {
    let calls = 0;
    fx.origin?.on("upgrade", (_req, socket) => {
      calls += 1;
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ok\r\n\r\n",
      );
    });
    const guarded = createProxyServer(baseOptions({ target: fx.originUrl, localToken: "secret" }));
    const url = await listenServer(guarded);
    const { socket: sock, head } = await upgradeThrough(url, "Authorization: Bearer secret");
    expect(head).toMatch(/^HTTP\/1\.1 101/);
    expect(calls).toBe(1);
    sock.destroy();
    guarded.close();
  });
});

describe("validation", () => {
  it("rejects non-loopback listen and bad targets", () => {
    expect(() => validateProxyOptions(baseOptions({ listen: "0.0.0.0:8443" }))).toThrow(
      /not loopback/,
    );
    expect(() => validateProxyOptions(baseOptions({ target: "ftp://x" }))).toThrow(/not allowed/);
    expect(() =>
      validateProxyOptions(baseOptions({ target: "http://x", unsafePlainTarget: false })),
    ).toThrow(/not allowed/);
  });
});
