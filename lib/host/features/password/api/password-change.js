import {} from "../../../entities/user/index.js";
import { checkRequestOrigin, formField, methodNotAllowed, parseCookieHeader, parseFormBody, } from "../../../shared/http/index.js";
import {} from "../../../shared/rate-limit/index.js";
import {} from "../../../entities/session/index.js";
import { runAdmitted } from "./password-change.submit.js";
import { handlePasswordChangePage, respondFormError, sendJson } from "../ui/password-change.ssr.js";
/**
 * `/auth/password`（P1 §1 + P2 §1/§6）。GET 走 SSR 自足页；POST 处理顺序冻结：
 * method 405（allow: GET, POST）→ parseFormBody(415/413) → Origin/Sec-Fetch-Site(403)
 * → 会话 cookie(401) → 限速桶(429) → 读 users(503) → 恒时验证旧口令(401) → TOTP(401)
 * → 策略(400) → hash → 锁内写盘(503) → recordSuccess + 撤销全部会话
 * → 清 cookie +（nav=1 时 302 登录页，否则既有 200 JSON）。
 * 顺序硬约束：写盘成功后才撤销会话；写盘失败绝不允许出现「全被踢但密码没改」。
 * Origin 放在 415/413 之后、401 之前：畸形 body 不必先做 CSRF 判定，缺来源的脚本
 * 得到 403 而不是假 401。
 */
export async function handlePasswordChange(deps, req, res) {
    if (req.method === "GET") {
        handlePasswordChangePage(deps, req, res);
        return;
    }
    if (req.method !== "POST") {
        methodNotAllowed(res, "GET, POST");
        return;
    }
    let params;
    try {
        params = await parseFormBody(req);
    }
    catch (error) {
        respondFormError(res, error);
        return;
    }
    if (!originAccepted(deps, req, res))
        return;
    // 请求字段**不 trim 不截断**：口令按原始码点判定。
    const current = formField(params, "current");
    const newPassword = formField(params, "password");
    const code = formField(params, "code");
    const subject = locateSession(deps, req)?.subject;
    if (subject === undefined) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
    }
    const ip = clientIpOf(deps, req);
    const admitted = deps.limiter.admit(ip, subject, "password-change");
    if (!admitted.admitted) {
        deps.logger.info("rate limit exceeded");
        res.setHeader("retry-after", String(admitted.retryAfterSeconds));
        sendJson(res, 429, { error: "locked", retryAfter: admitted.retryAfterSeconds });
        return;
    }
    const ctx = {
        ip,
        subject,
        current,
        secrets: [current, newPassword, code],
        admission: admitted.admission,
    };
    try {
        await runAdmitted(deps, res, ctx, params, newPassword, code);
    }
    finally {
        admitted.admission.settle("abandon"); // 已结算时是空操作；503/异常只释放占位
    }
}
/**
 * P2 §6：Origin / Sec-Fetch-Site 同源校验（fail-closed）；拒绝 → 403 JSON，不计限速。
 * `checkRequestOrigin` 按结构读 `headers` / `socket`，直接透传 `req` 即可。
 */
function originAccepted(deps, req, res) {
    const verdict = checkRequestOrigin(req, deps.publicHost ?? "");
    if (verdict.ok)
        return true;
    sendJson(res, 403, { error: "bad_origin" });
    return false;
}
/**
 * 会话定位：只认 cookie（M5），Bearer 不参与；store/token 无效或类别不在白名单 → undefined。
 * 白名单（G12 allow-list）只放行正式会话与「只能改密」的受限会话；bootstrap 会话与
 * 将来新增的 kind 默认都不许改密。旧行没有 `kind`，会话层语义按 full 处理。
 */
function locateSession(deps, req) {
    const store = deps.sessions();
    const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
    if (store === undefined || token === undefined || token === "")
        return undefined;
    const session = store.getByToken(token);
    return ["full", "password-change-only"].includes(session?.kind ?? "full") ? session : undefined;
}
/** D19：注入的解析器（受信反代 IP 头）优先，缺省回退 socket 地址。 */
function clientIpOf(deps, req) {
    return deps.clientIp?.(req) ?? req.socket.remoteAddress ?? "";
}
