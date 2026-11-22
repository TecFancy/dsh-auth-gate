import { totpChallengePageHtml } from "../../../shared/login-page/index.js";
import { loginPath } from "../../../shared/protocol/index.js";
import { buildSetCookie } from "../../../entities/session/index.js";
import { issueLoginSession } from "./session-issue.js";
import { INVALID_TOTP_CODE, sendTotpLockout } from "../ui/login-failure-pages.js";
import { CHALLENGE_COOKIE } from "./challenge-cookie.js";
import { loadUsersOr503, requireStore } from "./login-store.js";
/** TOTP 挑战提交：受理 → 用户文件 → 恒时验证 → 防重放 → 禁用检查 → 发会话。 */
export async function handleTotpSubmit(deps, host, res, username, code, next, ip) {
    // 第二段继承口令段的锁定（同一个客户端/账号被锁时，旧挑战也不能继续猜），
    // 但**计数只落在 totp 域**：口令段成功清不到它（P1）。
    const inherited = deps.limiter.check(ip, username, "login");
    if (!inherited.allowed) {
        sendTotpLockout(res, { host, next, username }, inherited.retryAfterSeconds);
        deps.logger.info("rate limit exceeded");
        return;
    }
    const admitted = deps.limiter.admit(ip, username, "totp");
    if (!admitted.admitted) {
        sendTotpLockout(res, { host, next, username }, admitted.retryAfterSeconds);
        deps.logger.info("rate limit exceeded");
        return;
    }
    try {
        await submitVerified(deps, host, res, username, code, next, admitted.admission);
    }
    finally {
        admitted.admission.settle("abandon"); // 已结算时是空操作；503/异常只释放占位
    }
}
async function submitVerified(deps, host, res, username, code, next, admission) {
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return;
    const user = loaded.snapshot.users.get(username);
    if (user?.totpSecret === undefined) {
        admission.settle("failure");
        rejectTotp(deps, host, res, next, username);
        return;
    }
    // disabled 检查放在恒时验证之后（对齐 P9 密码路径：禁用用户仍跑真实验证，
    // 不给禁用账号计时侧信道）；码已匹配时防重放已登记，fail-closed 可接受。
    const matched = deps.verifyTotp(user.totpSecret, code, deps.now());
    const replay = matched !== undefined && deps.replayCheck(username, matched, code);
    if (matched === undefined || !replay || user.disabled) {
        admission.settle("failure");
        rejectTotp(deps, host, res, next, username);
        return;
    }
    // 先取 store 再结算：session store 不可用（503）时不记成功，已积累的计数保留（T8 限速连续）。
    const store = requireStore(deps, res);
    if (store === undefined)
        return;
    admission.settle("success");
    // 清挑战 cookie + 发会话（M4 T6：一次性，防重放再收窄）；set-cookie 用数组
    // （Node 重复 setHeader 会覆盖，必须同一次写两个 cookie）。
    // P2 ④：带 must_change_password 标记 → 受限会话（302 /auth/password，忽略 next）。
    await issueLoginSession(deps, res, store, username, next, user, [
        buildSetCookie(CHALLENGE_COOKIE, "", 0, deps.cookieSecure),
    ]);
}
/** TOTP 拒绝路径（P1.3）：401 + 挑战页 HTML（error slot 固定常量文案，浏览器表单可见；
 * 不读 query error=，避免开放重定向式任意文案；挑战 cookie 保留，可重试）。
 * 文案取 `INVALID_TOTP_CODE`（D21）：走到这一步口令是对的，不能复用凭据常量。 */
function rejectTotp(deps, host, res, next, username) {
    deps.logger.info("login rejected");
    res.setHeader("cache-control", "no-store");
    res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
    res.end(totpChallengePageHtml(next, INVALID_TOTP_CODE, {
        host,
        who: username,
        resetHref: loginPath(next, "password"),
    }));
}
