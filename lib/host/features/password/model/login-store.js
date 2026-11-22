/** 会话存储不可用 → 503（不计失败、不清桶，T8）；可用则返回 store。 */
export function requireStore(deps, res) {
    const store = deps.sessions();
    if (store !== undefined)
        return store;
    res.setHeader("cache-control", "no-store");
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("session store unavailable");
    deps.logger.error("login failed: session store unavailable");
    return undefined;
}
/** 读取用户文件；失败 → 503 + error 日志并返回 undefined（不计失败）。 */
export async function loadUsersOr503(deps, res) {
    try {
        return await deps.loadUsers();
    }
    catch (error) {
        res.setHeader("cache-control", "no-store");
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("user store unavailable");
        deps.logger.error(`user store unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}
