import type { AdmitHook, Gate, GuardKind, GuardRequest } from "./gate.js";
/**
 * Fetch 形态的 resource 路由处理函数（DSH 0.2.2 起 `webServer.register` 支持）。
 * `peer` 对插件保持不透明，守卫原样转发；返回的 `Response` 由宿主直接写回连接。
 */
export type ResourceHandler = (request: Request, peer?: unknown) => Promise<Response>;
/**
 * 把 Fetch `Request` 收窄成门需要的三项。请求头逐项复制成普通对象，不依赖
 * `Headers` 的迭代器类型，也不读取 body：门是同步判定，不消费请求体。
 */
export declare function toGuardRequest(request: Request): GuardRequest;
/**
 * 给一条 resource 路由套守卫。已守卫（幂等）则原样返回。
 *
 * 放行时把原 `Request`、`peer` 和原 `Response` 原样交给 resource，不读、不克隆、
 * 不解压响应体，gzip、Range 与流式响应都不受影响；拒绝时用与 handler 同源的
 * `denyReply` 生成模型，再转成 Fetch `Response`。HEAD 的拒绝不带正文。
 *
 * 非法 URL（连带 base 的 `new URL` 都抛错）直接 400，不调门、不调 resource。
 * 门或 resource 抛错时向上传播，由宿主统一处理，绝不"出错即放行"。
 * `onAdmit` 在门放行之后调用一次，语义与 handler 入口相同（见 {@link AdmitHook}）。
 */
export declare function guardResource(gate: () => Gate, kind: GuardKind, resource: ResourceHandler, onAdmit?: AdmitHook): ResourceHandler;
//# sourceMappingURL=resource.d.ts.map