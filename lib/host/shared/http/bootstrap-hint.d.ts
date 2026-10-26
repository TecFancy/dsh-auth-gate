import type { IncomingMessage } from "node:http";
/**
 * `token` 查询参数：必须**恰好一项**且 trim 后非空，否则 undefined。
 * 多值一律拒绝（`?token=a&token=b` 没有"哪个才算"的正确答案），空串/纯空白同理。
 */
export declare function singleTokenParam(params: URLSearchParams): string | undefined;
/**
 * 首次引导的请求形状判定：`GET` + pathname 恰为 `/` + 恰好一个非空 `token` 查询 → 引导端点
 * 路径（token 原样重新编码）；其它形状 → undefined。
 *
 * 门只做这一步形态判断，**不校验** token、不读文件、不 await：真正的校验、未配置探针与会话
 * 签发都在 `GET /auth/bootstrap` 里完成，被冻结的守卫词表因此一行不用改。
 */
export declare function bootstrapRedirectPath(req: IncomingMessage): string | undefined;
//# sourceMappingURL=bootstrap-hint.d.ts.map