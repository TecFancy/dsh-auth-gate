import { parseCookieHeader } from "../../../shared/http/index.js";
/**
 * 门与宿主鉴权共用的会话解析：先 cookie，再 `Authorization: Bearer <会话 token>`。
 *
 * 两条通道读同一张会话表（可吊销、可过期），没有 store / 没有凭证 / 已失效 → `undefined`。
 * 这是 password 门原本的私有逻辑（提取自 password-gate.ts）：0.2.3-alpha.2 起宿主
 * `required` 路由的 Peer 选择也要用同一份判定，所以下沉到实体层避免两处漂移。
 * token 模式的 Bearer 是共享访问令牌而非会话 token，查表自然落空，行为不变。
 */
export function sessionOfRequest(request, cookieName, sessions) {
    if (sessions === undefined)
        return undefined;
    const cookie = parseCookieHeader(request.headers.cookie, cookieName);
    if (cookie !== undefined && cookie !== "") {
        const row = sessions.getByToken(cookie);
        if (row !== undefined)
            return row;
    }
    const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1];
    return bearer === undefined ? undefined : sessions.getByToken(bearer);
}
