import type { AdmitHook, Gate, GuardKind, GuardRequest } from "./gate.js";
import { type AdmitRebridge } from "./rebridge.js";
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
 * `onAdmit` 在门放行之后调用一次，语义与 handler 入口相同（见 {@link AdmitHook}）；
 * `rebridge` 的询问时机与顺序也与 handler 入口相同：跨站弹回在前、重铸在后（见
 * {@link AdmitRebridge}）。
 *
 * **进程内的 `readResource(request, peer)` 读不进门，也不走下面的浏览器检查。** 宿主
 * `webServer.readResource(request, peer)` 的契约是"调用方已经放行这个读者再读"，而 `peer`
 * 就是那次放行本身；这种读没有 cookie、没有 Host/Origin，门没有可判定的事实，却会按匿名拒成
 * 401。LiveShare 的 viewer 页面正是这样读的：owner 的分享宿主用 reader 的 `peer` 读首页与
 * shell 资源，请求由 `new Request(target)` 构造、**不带任何请求头**。
 *
 * 0.2.3-alpha.2 起「带 peer」不再等于「进程内读」：required 的 resource 路由在网络分发时也把
 * `admission.peer` 交给 resource（SPA 索引渲染需要它）。所以判定看请求事实而不是只看 peer：
 * 没有任何请求头 → 进程内读，原样交回；有请求头 → 按浏览器请求走门（fail-closed：网络请求
 * 至少带 Host，带头的读绝不被误放行）。`onAdmit`（匿名统计）只数浏览器请求，进程内读不计数；
 * 代理标记、跨站弹回、重铸都只对浏览器请求有意义，一并跳过。
 */
export declare function guardResource(gate: () => Gate, kind: GuardKind, resource: ResourceHandler, onAdmit?: AdmitHook, rebridgeHook?: AdmitRebridge): ResourceHandler;
