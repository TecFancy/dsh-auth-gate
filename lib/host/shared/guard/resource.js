import { crossSiteBounceResponse, isCrossSiteDocumentNavigation } from "./cross-site-bounce.js";
import { badRequestReply, denyReply, forbiddenReply, guardReplyToResponse, isProxyDeniedRequest, rebridgeReply, } from "./http.js";
import { GUARDED, isGuarded } from "./mark.js";
import { rebridgeDecision } from "./rebridge.js";
/**
 * 把 Fetch `Request` 收窄成门需要的三项。请求头逐项复制成普通对象，不依赖
 * `Headers` 的迭代器类型，也不读取 body：门是同步判定，不消费请求体。
 */
export function toGuardRequest(request) {
    const headers = {};
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
 * `onAdmit` 在门放行之后调用一次，语义与 handler 入口相同（见 {@link AdmitHook}）；
 * `rebridge` 的询问时机与顺序也与 handler 入口相同：跨站弹回在前、重铸在后（见
 * {@link AdmitRebridge}）。
 *
 * **带 `peer` 的读不进门，也不走下面的浏览器检查。** 宿主
 * `webServer.readResource(request, peer)` 的契约是"调用方已经放行这个读者再读"，
 * 而 `peer` 就是那次放行本身（见 `dsh-host-webserver` 的 `readResource` 注释）；
 * 这种读发生在进程内，没有 cookie、没有 Host/Origin，门没有可判定的事实，却会
 * 按匿名拒成 401。LiveShare 的 viewer 页面正是这样读的：owner 的分享宿主用
 * reader 的 `peer` 读首页与 shell 资源。宿主自己的 fallback 就按
 * `peer === undefined` 与否分开处理（`dsh-host-frontend-static`），守卫跟随同一条
 * 分界：`peer` 在，就直接把原 `Request`、`peer` 和原 `Response` 交回；进程内调用方
 * 本来就有进程权限，绕过门不额外扩权。`onAdmit`（匿名统计）只数浏览器请求，
 * 这种读不计数；代理标记、跨站弹回、重铸都只对浏览器请求有意义，一并跳过。
 */
export function guardResource(gate, kind, resource, onAdmit, rebridgeHook) {
    if (isGuarded(resource))
        return resource;
    const guarded = (async (request, peer) => {
        let pathname;
        try {
            pathname = new URL(request.url, "http://x").pathname;
        }
        catch {
            return guardReplyToResponse(badRequestReply());
        }
        // 带 peer 的读是进程内调用方已经放行的读，门不再判定（细则见上方文档注释）。
        if (peer !== undefined)
            return resource(request, peer);
        const req = toGuardRequest(request);
        const decision = await gate().decide(req, kind, pathname);
        if (decision === "allow") {
            onAdmit?.();
            if (isProxyDeniedRequest(req, pathname)) {
                return guardReplyToResponse(forbiddenReply());
            }
            if (isCrossSiteDocumentNavigation(req)) {
                return crossSiteBounceResponse();
            }
            const rebridge = rebridgeDecision(rebridgeHook, req, kind, pathname);
            if (rebridge !== undefined) {
                const reply = rebridgeReply(rebridge.location, rebridge.setCookie);
                if (request.method === "HEAD")
                    reply.body = null;
                return guardReplyToResponse(reply);
            }
            return resource(request, peer);
        }
        const reply = denyReply(req, decision);
        if (request.method === "HEAD")
            reply.body = null;
        return guardReplyToResponse(reply);
    });
    guarded[GUARDED] = true;
    return guarded;
}
//# sourceMappingURL=resource.js.map