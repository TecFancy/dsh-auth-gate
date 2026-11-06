import type { Gate, GuardKind, GuardRequest } from "./gate.js";
import { crossSiteBounceResponse, isCrossSiteDocumentNavigation } from "./cross-site-bounce.js";
import {
  badRequestReply,
  denyReply,
  forbiddenReply,
  guardReplyToResponse,
  isProxyDeniedRequest,
} from "./http.js";
import { GUARDED, isGuarded } from "./mark.js";

/**
 * Fetch 形态的 resource 路由处理函数（DSH 0.2.2 起 `webServer.register` 支持）。
 * `peer` 对插件保持不透明，守卫原样转发；返回的 `Response` 由宿主直接写回连接。
 */
export type ResourceHandler = (request: Request, peer?: unknown) => Promise<Response>;

/**
 * 把 Fetch `Request` 收窄成门需要的三项。请求头逐项复制成普通对象，不依赖
 * `Headers` 的迭代器类型，也不读取 body：门是同步判定，不消费请求体。
 */
export function toGuardRequest(request: Request): GuardRequest {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { url: request.url, method: request.method, headers };
}

/**
 * 给一条 resource 路由套守卫。已守卫（幂等）则原样返回。
 *
 * 放行时把原 `Request`、`peer` 和原 `Response` 原样交给 resource，不读、不克隆、
 * 不解压响应体，gzip、Range 与流式响应都不受影响；拒绝时用与 handler 同源的
 * `denyReply` 生成模型，再转成 Fetch `Response`。HEAD 的拒绝不带正文。
 *
 * 非法 URL（连带 base 的 `new URL` 都抛错）直接 400，不调门、不调 resource。
 * 门或 resource 抛错时向上传播，由宿主统一处理，绝不"出错即放行"。
 */
export function guardResource(
  gate: () => Gate,
  kind: GuardKind,
  resource: ResourceHandler,
): ResourceHandler {
  if (isGuarded(resource)) return resource;
  const guarded = (async (request: Request, peer?: unknown): Promise<Response> => {
    let pathname: string;
    try {
      pathname = new URL(request.url, "http://x").pathname;
    } catch {
      return guardReplyToResponse(badRequestReply());
    }
    const req = toGuardRequest(request);
    const decision = await gate().decide(req, kind, pathname);
    if (decision === "allow") {
      if (isProxyDeniedRequest(req, pathname)) {
        return guardReplyToResponse(forbiddenReply());
      }
      if (isCrossSiteDocumentNavigation(req)) {
        return crossSiteBounceResponse();
      }
      return resource(request, peer);
    }
    const reply = denyReply(req, decision);
    if (request.method === "HEAD") reply.body = null;
    return guardReplyToResponse(reply);
  }) as ResourceHandler & { [GUARDED]?: true };
  guarded[GUARDED] = true;
  return guarded;
}
