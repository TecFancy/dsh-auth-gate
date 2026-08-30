import type { IncomingMessage } from "node:http";
/** urlencoded 请求体大小上限（M10）。 */
export declare const FORM_BODY_LIMIT: number;
/**
 * 读取并解析 urlencoded 请求体。content-type 不符 → `{ status: 415 }`；
 * 超限 → `{ status: 413 }`（M19：不调用 `req.destroy()`）。两者都是带 `status`
 * 字段的 Error；**不带 `status` 的流异常（abort 等）不捕获，向上抛**（webserver
 * 统一 warn + 400，与守卫纪律一致）。
 */
export declare function parseFormBody(req: IncomingMessage): Promise<URLSearchParams>;
//# sourceMappingURL=form-body.d.ts.map