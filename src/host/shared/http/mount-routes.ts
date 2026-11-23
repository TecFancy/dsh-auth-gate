import type { HttpHandler, HostAuthRule } from "../guard/index.js";

/**
 * 一条可注册的 `/auth` 端点路由。webserver 没有 method 路由：`exact` 只按 pathname
 * 建键，GET/POST 由 handler 内部分发。
 */
export interface MountedRoute {
  kind: "exact" | "prefix";
  path: string;
  handler: HttpHandler;
  /** 覆盖宿主的默认 `auth: "required"`；缺省按 `/auth` 端点声明为 `anonymous`。 */
  auth?: HostAuthRule;
}

/** 注册一条路由并返回它的 disposer（`src/index.ts` 传入包装后的 `server.register`）。 */
export type RouteRegister = (route: MountedRoute) => () => void;

/**
 * 逆序释放全部 disposer。回滚阶段吞掉异常（首个 register 的原始错误更值得抛），
 * 正常卸载阶段则先摘完所有路由、最后把第一个异常抛出去：一个 disposer 抛错不能
 * 让后面的路由留在宿主表里。
 */
function disposeAll(disposers: readonly (() => void)[], swallow: boolean): void {
  let firstError: unknown;
  for (const dispose of [...disposers].reverse()) {
    try {
      dispose();
    } catch (error) {
      if (swallow) continue;
      firstError ??= error;
    }
  }
  if (firstError !== undefined) {
    throw firstError instanceof Error ? firstError : new Error("route disposer failed");
  }
}

/**
 * 逐条注册路由并收集 disposer，返回合并 disposer（逆序释放）。
 *
 * `/auth` 端点必须自己声明 `auth: "anonymous"`：DSH 0.2.3-alpha.2 起宿主路由默认
 * `required`，登录页/引导页/改密页要在**没有宿主会话**时可达（插件自己的门负责判定，
 * 宿主那一层不能再挡一次）。旧宿主没有这个字段，注册对象里的 `auth` 被忽略。
 *
 * 部分失败必须逐条回滚：`register` 一旦抛错，前面已经注册的路由仍在宿主表里，而它们的
 * disposer 还没被收集起来。直接向上抛会留下守卫指着已卸载插件的路由，重试还会撞
 * "duplicate route"（security.md §2 的逐条回滚纪律）。
 */
export function mountRoutes(register: RouteRegister, routes: readonly MountedRoute[]): () => void {
  const disposers: (() => void)[] = [];
  try {
    for (const route of routes) {
      disposers.push(register(route.auth === undefined ? { ...route, auth: "anonymous" } : route));
    }
  } catch (error) {
    disposeAll(disposers, true);
    throw error;
  }
  return () => disposeAll(disposers, false);
}
