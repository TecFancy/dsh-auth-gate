import { parseCookieHeader } from "../../shared/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
/**
 * password 模式门（P12）：白名单 → 会话 cookie → Bearer 会话 token → deny。
 * 门内零 KDF、零文件 IO、同步返回；Bearer 通道按会话查表（可吊销可过期）。
 */
export class PasswordGate {
    sessions;
    cookieName;
    constructor(options) {
        this.sessions = options.sessions;
        this.cookieName = options.cookieName;
    }
    decide(req, _kind, pathname) {
        if (pathname === AUTH_PATH_PREFIX || pathname.startsWith(AUTH_PATH_PREFIX + "/")) {
            return "allow";
        }
        const store = this.sessions();
        if (store === undefined)
            return "deny";
        const cookie = parseCookieHeader(req.headers.cookie, this.cookieName);
        if (cookie !== undefined && cookie !== "" && store.getByToken(cookie) !== undefined) {
            return "allow";
        }
        const authorization = req.headers.authorization;
        const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
        if (match !== null) {
            const bearer = match[1];
            if (bearer !== undefined && store.getByToken(bearer) !== undefined)
                return "allow";
        }
        return "deny";
    }
}
//# sourceMappingURL=password-gate.js.map