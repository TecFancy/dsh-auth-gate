import { describe, expect, it } from "vitest";
import {
  makeDeps,
  makeRes,
  session,
  statusReq,
  storeWith,
} from "../../../../../test/session-status-harness.js";
import { handleStatus } from "./session-endpoints.js";

/**
 * `/auth/status` 的两个**实例事实**字段：`mode` 与 `version`。
 *
 * 它们与身份无关（未认证响应同样带），因此这里不需要 users.yaml：只钉住"已知才写、
 * 未知整键缺席"这一条，以及它们不改变未认证/已认证两种响应里的既有键集合。
 */

async function body(deps: Parameters<typeof handleStatus>[0], cookie?: string) {
  const res = makeRes();
  await handleStatus(deps, statusReq(cookie), res.res);
  return res.json();
}

describe("GET /auth/status: instance facts", () => {
  it("writes version and mode when the root wiring supplies them", async () => {
    const deps = makeDeps({ version: "0.24.0", mode: "token" });
    expect(await body(deps, "dsh_auth=good")).toEqual({
      authenticated: true,
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
      mode: "token",
      version: "0.24.0",
    });
  });

  it("carries the same facts on an unauthenticated response (they are not identity)", async () => {
    const deps = makeDeps({ version: "0.24.0", mode: "password" });
    expect(await body(deps)).toEqual({
      authenticated: false,
      logoutOrder: 42,
      passkeyEnabled: false,
      passwordLoginDisabled: false,
      mode: "password",
      version: "0.24.0",
    });
  });

  it("omits both keys when unknown instead of inventing a value", async () => {
    // 旧装配 / 测试字面量不提供它们：整键缺席，客户端据此按"不知道"渲染。
    const res = await body(makeDeps(), "dsh_auth=good");
    expect(res).not.toHaveProperty("mode");
    expect(res).not.toHaveProperty("version");
  });

  it("never writes an empty version (empty means unreadable package.json)", async () => {
    const deps = makeDeps({ version: "", mode: "token" });
    const res = await body(deps, "dsh_auth=good");
    expect(res).not.toHaveProperty("version");
    expect(res).toHaveProperty("mode", "token");
  });

  it("keeps the identity projection unchanged when facts are present", async () => {
    // 加法兼容：新增两键不得改动"关于我"那组的键与值。
    const deps = makeDeps({ version: "0.24.0", mode: "password" });
    const res = await body(deps, "dsh_auth=good");
    expect(Object.keys(res).sort((a, b) => a.localeCompare(b))).toEqual([
      "authenticated",
      "logoutOrder",
      "mode",
      "passkeyEnabled",
      "passwordLoginDisabled",
      "version",
    ]);
  });

  it("does not widen the response when a session is missing but a store exists", async () => {
    const deps = makeDeps({ version: "0.24.0", mode: "password", store: storeWith({}) });
    const res = await body(deps, "dsh_auth=good");
    expect(res["authenticated"]).toBe(false);
    expect(res["version"]).toBe("0.24.0");
  });

  it("reports facts even when the users file is unavailable", async () => {
    const deps = makeDeps({
      version: "0.24.0",
      mode: "password",
      store: storeWith({ good: session() }),
      loadUsers: () => Promise.reject(new Error("EACCES")),
      errors: [],
    });
    const res = await body(deps, "dsh_auth=good");
    // 读盘失败退回基础字段，但实例事实照旧（它们不依赖 users.yaml）。
    expect(res["version"]).toBe("0.24.0");
    expect(res).not.toHaveProperty("name");
  });
});
