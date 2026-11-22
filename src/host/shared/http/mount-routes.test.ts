import { describe, expect, it } from "vitest";
import type { HttpHandler } from "../guard/index.js";
import { mountRoutes, type MountedRoute, type RouteRegister } from "./mount-routes.js";

const handler: HttpHandler = () => undefined;

function route(path: string): MountedRoute {
  return { kind: "exact", path, handler };
}

/** 记账式 register：把已注册路径推进 log，disposer 也记账，便于断言回滚顺序。 */
function recorder(options?: { throwOn?: string }): {
  register: RouteRegister;
  mounted: string[];
  disposed: string[];
} {
  const mounted: string[] = [];
  const disposed: string[] = [];
  const register: RouteRegister = (entry) => {
    if (entry.path === options?.throwOn) throw new Error(`duplicate route: ${entry.path}`);
    mounted.push(entry.path);
    return () => {
      disposed.push(entry.path);
    };
  };
  return { register, mounted, disposed };
}

describe("mountRoutes", () => {
  it("registers every route and returns a disposer that releases them in reverse order", () => {
    const { register, mounted, disposed } = recorder();
    const dispose = mountRoutes(register, [route("/a"), route("/b"), route("/c")]);
    expect(mounted).toEqual(["/a", "/b", "/c"]);

    dispose();
    expect(disposed).toEqual(["/c", "/b", "/a"]);
  });

  it("rolls the already-registered routes back (reverse order) when a later register throws", () => {
    const { register, mounted, disposed } = recorder({ throwOn: "/c" });
    expect(() =>
      mountRoutes(register, [route("/a"), route("/b"), route("/c"), route("/d")]),
    ).toThrow("duplicate route: /c");
    // 第三条抛错：前两条已经注册，必须按注册逆序摘掉；断言没有留下半套路由。
    expect(mounted).toEqual(["/a", "/b"]);
    expect(disposed).toEqual(["/b", "/a"]);
  });

  it("keeps rolling back when one disposer throws, then rethrows the register error", () => {
    const disposed: string[] = [];
    const register: RouteRegister = (entry) => {
      if (entry.path === "/c") throw new Error("duplicate route");
      return () => {
        disposed.push(entry.path);
        if (entry.path === "/b") throw new Error("disposer boom");
      };
    };
    expect(() => mountRoutes(register, [route("/a"), route("/b"), route("/c")])).toThrow(
      "duplicate route",
    );
    expect(disposed).toEqual(["/b", "/a"]);
  });

  it("registers zero routes as a no-op disposer", () => {
    const { register } = recorder();
    expect(() => mountRoutes(register, [])()).not.toThrow();
  });
});
