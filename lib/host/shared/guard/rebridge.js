import { isSafeLocation } from "./http.js";
/**
 * 询问重铸钩子并消毒它给出的 Location。
 *
 * 钩子缺失、抛错、或给出站外/带控制符的地址时一律返回 `undefined`（照常放行）：门已经
 * 放行过这次请求，重铸只是补救通道，它坏掉不该把一次合法请求变成错误。消毒放在这里而不是
 * 交给 `denyReply`，是因为后者的兜底是登录页-把已认证用户送去登录页比不重铸更糟。
 */
export function rebridgeDecision(rebridge, req, kind, pathname) {
    if (rebridge === undefined)
        return undefined;
    try {
        const decision = rebridge(req, kind, pathname);
        if (decision === undefined)
            return undefined;
        return isSafeLocation(decision.location) ? decision : undefined;
    }
    catch {
        return undefined;
    }
}
