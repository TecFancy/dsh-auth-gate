/** urlencoded 请求体大小上限（M10）。 */
export const FORM_BODY_LIMIT = 16 * 1024;
/**
 * 读取并解析 urlencoded 请求体。content-type 不符 → `{ status: 415 }`；
 * 超限 → `{ status: 413 }`（M19：不调用 `req.destroy()`）。两者都是带 `status`
 * 字段的 Error；**不带 `status` 的流异常（abort 等）不捕获，向上抛**（webserver
 * 统一 warn + 400，与守卫纪律一致）。
 */
export async function parseFormBody(req) {
    const rawType = req.headers["content-type"];
    const mediaType = typeof rawType === "string" ? rawType.split(";")[0]?.trim().toLowerCase() : undefined;
    if (mediaType !== "application/x-www-form-urlencoded") {
        throw Object.assign(new Error("unsupported media type"), { status: 415 });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        size += buffer.length;
        if (size > FORM_BODY_LIMIT) {
            throw Object.assign(new Error("request body too large"), { status: 413 });
        }
        chunks.push(buffer);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
//# sourceMappingURL=form-body.js.map