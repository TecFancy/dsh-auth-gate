/**
 * 构造共享 token 的凭证解析器（token 模式；从 `src/index.ts` 拆出以守住文件行数上限）。
 *
 * 每次调用惰性取服务：实测 harness 并行挂载行，credentials 行可能在本行 apply 之后
 * 才就绪；每次 resolve 现取既是 M2 的 per-operation 语义，也天然规避竞态。
 * 服务缺失 → 首次解析时 `log.error`（fail-closed）；解析失败 → `log.error` 并返回
 * undefined（登录/门都按"无凭证"处理）。
 */
export function makeTokenResolver(ctx, config, log) {
    let warnedMissing = false;
    return async () => {
        const credentials = ctx.get("credentials");
        if (credentials === undefined) {
            if (!warnedMissing) {
                warnedMissing = true;
                log.error("credentials service is unavailable: gate denies everything (fail-closed)");
            }
            return undefined;
        }
        try {
            const resolved = await credentials.resolve(config.tokenRef);
            return resolved?.value;
        }
        catch (error) {
            log.error(`token resolution failed: ${error instanceof Error ? error.message : String(error)}`);
            return undefined; // fail-closed：解析失败 = 无凭证
        }
    };
}
//# sourceMappingURL=token-resolver.js.map