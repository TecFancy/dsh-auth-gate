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
/**
 * 按请求体契约读一个表单字段（缺席 = 空串，不 trim）。`T` 是 `src/protocol/` 里的请求体类型，
 * 必须显式给出：字段名受它约束，写错名字编译不过，host 与 client 认的是同一组键。
 */
export declare function formField<T extends object>(params: URLSearchParams, name: keyof T & string): string;
//# sourceMappingURL=form-body.d.ts.map