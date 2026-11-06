import z from "@deepseek-ai/schemastery";
import { defaultUsersFilePath, loadUsersFile } from "./host/entities/user/index.js";
import { makeTelemetry, } from "./host/shared/telemetry/index.js";
/** 两个配置项对应的 schema 节点（展开进 `src/index.ts` 的 `Config`，顺序即绑定顺序）。 */
export const telemetryConfigFields = {
    installId: z.string().default("").volatile().hidden(true),
    telemetry: z.boolean().default(true),
};
/**
 * 装好匿名上报，返回守卫的放行钩子。
 *
 * 用户数**不在请求路径上读**：只有上报真正到期（至多每 24 小时一次）时，才用现有的
 * `loadUsersFile` 解析一遍 users.yaml 取用户数；token 模式不读盘，恒报 `"1"`。
 *
 * @param ctx - 宿主上下文（`settings` 惰性现取，与 `credentials` 同一套软接方式）。
 * @param config - 上报需要的配置子集（users.yaml 路径也在这里解析，与登录路径同一个文件）。
 * @returns 交给 `wrapServer` 的放行钩子；`telemetry: false` 时为 undefined（不挂钩子）。
 */
export function wireTelemetry(ctx, config) {
    const usersPath = config.usersFile === "" ? defaultUsersFilePath() : config.usersFile;
    const telemetry = makeTelemetry({
        enabled: config.telemetry,
        mode: config.mode,
        totp: config.totp,
        installId: () => config.installId.get(),
        settings: () => settingsServiceOf(ctx),
        readUsers: async () => {
            try {
                const loaded = await loadUsersFile(usersPath);
                return loaded.missing ? 0 : loaded.snapshot.users.size;
            }
            catch {
                return undefined;
            }
        },
    });
    return telemetry.enabled ? () => telemetry.noteAdmitted() : undefined;
}
/**
 * 宿主的 settings 服务（惰性现取：harness 并行挂载行，服务可能晚于本行就绪）。
 *
 * 只认带 `update` 的对象。缺失不是停用条件：生成的 installId 只留在内存里（每次重启换一个，
 * 服务端按 (id, 当天) 去重），照样上报，但**不**退化到写文件。读用 `ctx.get` 而不是属性代理：
 * 未声明的服务经代理读会抛错，`get` 只是返回 undefined。
 */
function settingsServiceOf(ctx) {
    const service = ctx.get("settings");
    return typeof service === "object" && service !== null && typeof service.update === "function"
        ? service
        : undefined;
}
//# sourceMappingURL=telemetry-wiring.js.map