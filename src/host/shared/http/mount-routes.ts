import type { HttpHandler } from "../guard/index.js";

/**
 * 一条可注册的 `/auth` 端点路由。webserver 没有 method 路由：`exact` 只按 pathname
 * 建键，GET/POST 由 handler 内部分发。
 */
export interface MountedRoute {
  kind: "exact" | "prefix";
  path: string;
  handler: HttpHandler;
}

/** 注册一条路由并返回它的 disposer（`src/index.ts` 传入包装后的 `server.register`）。 */
export type RouteRegister = (route: MountedRoute) => () => void;

/** 逆序释放；回滚阶段吞掉单个 disposer 的异常，保证已注册的条目都摘掉后再重抛原错误。 */
function disposeAll(disposers: readonly (() => void)[], swallow: boolean): void {
  for (const dispose of [...disposers].reverse()) {
    if (!swallow) {
      dispose();
      continue;
    }
    try {
      dispose();
    } catch {
      // 回滚继续：首个 register 的原始错误才是调用方需要看到的。
    }
  }
}

/**
 * 逐条注册路由并收集 disposer，返回合并 disposer（逆序释放）。
 *
 * 部分失败必须逐条回滚：`register` 一旦抛错，前面已经注册的路由仍在宿主表里，而它们的
 * disposer 还没被收集起来。直接向上抛会留下守卫指着已卸载插件的路由，重试还会撞
 * "duplicate route"（security.md §2 的逐条回滚纪律）。
 */
export function mountRoutes(register: RouteRegister, routes: readonly MountedRoute[]): () => void {
  const disposers: (() => void)[] = [];
  try {
    for (const route of routes) disposers.push(register(route));
  } catch (error) {
    disposeAll(disposers, true);
    throw error;
  }
  return () => disposeAll(disposers, false);
}
