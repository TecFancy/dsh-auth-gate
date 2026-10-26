import { loadUsersFile } from "../../../entities/user/index.js";
/**
 * 未配置探针。
 *
 * - token 模式：调用方**必须**传严格读取器，解析器给出空值 → `unconfigured`；非空 →
 *   `configured`；读取器缺席或抛错 → `unknown`。不要把 `makeTokenResolver` 传进来：它把
 *   服务缺失与解析异常都吞成 `undefined`，会让读故障被误判成未配置；吞错语义只服务门自己。
 * - password 模式：文件缺失或零用户 → `unconfigured`；有用户 → `configured`；读/解析/权限
 *   错误 → `unknown`。
 */
export function makeConfiguredProbe(deps) {
    return {
        async state() {
            if (deps.markedConfigured.value)
                return "configured";
            try {
                return deps.mode === "password"
                    ? await probePassword(deps.usersPath)
                    : await probeToken(deps.resolveToken);
            }
            catch {
                return "unknown";
            }
        },
        markConfigured() {
            deps.markedConfigured.value = true;
        },
    };
}
async function probeToken(resolveToken) {
    if (resolveToken === undefined)
        return "unknown";
    const token = await resolveToken();
    return token === undefined || token === "" ? "unconfigured" : "configured";
}
async function probePassword(usersPath) {
    const loaded = await loadUsersFile(usersPath);
    return loaded.missing || loaded.snapshot.users.size === 0 ? "unconfigured" : "configured";
}
//# sourceMappingURL=probe.js.map