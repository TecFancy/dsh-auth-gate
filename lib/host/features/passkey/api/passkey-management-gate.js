import { methodNotAllowed, parseFormBody } from "../../../shared/http/index.js";
import { authedRequest, isRestrictedSession, loadPasskeyUsersOr503, locatePasskeySession, passkeyOriginAccepted, respondPasskeyFormError, sendPasskeyError, sendPasskeyStoreUnavailable, } from "./passkey-management-http.js";
/** 空参数集（GET 路径用，避免调用方到处判空）。 */
const NO_PARAMS = new URLSearchParams();
/**
 * 跑完整门禁。返回 `handled` 时响应已写完，调用方直接 return。
 * 405 用 `methodNotAllowed`（与既有端点同形：`allow` 头 + text/plain）。
 */
export async function passkeyManagementGate(deps, req, res, options) {
    if (req.method !== options.method) {
        methodNotAllowed(res, options.method);
        return { kind: "handled" };
    }
    let params = NO_PARAMS;
    if (options.form) {
        try {
            params = await parseFormBody(req);
        }
        catch (error) {
            respondPasskeyFormError(res, error);
            return { kind: "handled" };
        }
    }
    if (options.origin && !passkeyOriginAccepted(deps, req)) {
        sendPasskeyError(res, 403, "forbidden");
        return { kind: "handled" };
    }
    const lookup = locatePasskeySession(deps, req);
    if (lookup.kind === "unavailable") {
        sendPasskeyStoreUnavailable(res);
        return { kind: "handled" };
    }
    if (lookup.kind === "no-cookie") {
        sendPasskeyError(res, 401, "unauthorized");
        return { kind: "handled" };
    }
    if (isRestrictedSession(lookup.session)) {
        sendPasskeyError(res, 403, "forbidden");
        return { kind: "handled" };
    }
    const ip = deps.clientIp(req);
    if (options.limiter) {
        const lockout = deps.limiter.check(ip, lookup.session.subject);
        if (!lockout.allowed) {
            res.setHeader("retry-after", String(lockout.retryAfterSeconds));
            sendPasskeyError(res, 429, "locked");
            return { kind: "handled" };
        }
    }
    const loaded = await loadPasskeyUsersOr503(deps, res);
    if (loaded === undefined)
        return { kind: "handled" };
    const authed = authedRequest(lookup.session, loaded);
    if (authed === undefined) {
        sendPasskeyError(res, 401, "unauthorized");
        return { kind: "handled" };
    }
    return { kind: "proceed", context: { authed, params, ip } };
}
//# sourceMappingURL=passkey-management-gate.js.map