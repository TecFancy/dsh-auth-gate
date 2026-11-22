import type { Context } from "@deepseek-ai/cordis";

/** credentials 服务的结构镜像（M2 spec §3.1）；token 模式专用，本文件私有。 */
interface CredentialRefResolver {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
}

/** 共享访问令牌的最小长度下限（字符数）：配置 schema 的下限与默认值。 */
export const DEFAULT_TOKEN_MIN_LENGTH = 32;

/** `makeTokenResolver` 只需要配置里的 `tokenRef` 与令牌长度下限。 */
interface TokenResolverConfig {
  readonly tokenRef: string;
  /** 令牌长度下限（字符数）；缺省 {@link DEFAULT_TOKEN_MIN_LENGTH}。 */
  readonly tokenMinLength?: number | undefined;
}

/**
 * 构造共享 token 的凭证解析器（token 模式；从 `src/index.ts` 拆出以守住文件行数上限）。
 *
 * 每次调用惰性取服务：实测 harness 并行挂载行，credentials 行可能在本行 apply 之后
 * 才就绪；每次 resolve 现取既是 M2 的 per-operation 语义，也天然规避竞态。
 * 服务缺失 → 首次解析时 `log.error`（fail-closed）；解析失败 → `log.error` 并返回
 * undefined（登录/门都按"无凭证"处理）。
 *
 * 熵下限（L4）：长度短于 `tokenMinLength` 的令牌按"无凭证"返回 undefined：登录与
 * Bearer 门因此 fail-closed 拒绝，而启动期不会被"尚未配置"的实例误伤。只比字符数，
 * 不做熵估计；换成长令牌后自动恢复（告警去重状态随之下次可再触发）。
 */
export function makeTokenResolver(
  ctx: Context,
  config: TokenResolverConfig,
  log: { error(message: unknown): void },
): () => Promise<string | undefined> {
  const minLength = config.tokenMinLength ?? DEFAULT_TOKEN_MIN_LENGTH;
  let warnedMissing = false;
  let warnedShort = false;
  return async () => {
    const credentials = ctx.get("credentials") as unknown as CredentialRefResolver | undefined;
    if (credentials === undefined) {
      if (!warnedMissing) {
        warnedMissing = true;
        log.error("credentials service is unavailable: gate denies everything (fail-closed)");
      }
      return undefined;
    }
    try {
      const resolved = await credentials.resolve(config.tokenRef);
      const value = resolved?.value;
      if (value === undefined || value.length >= minLength) {
        warnedShort = false;
        return value;
      }
      if (!warnedShort) {
        warnedShort = true;
        log.error(
          `access token is shorter than tokenMinLength (${minLength} chars): treating it as unavailable (fail-closed) until it is replaced`,
        );
      }
      return undefined;
    } catch (error) {
      log.error(
        `token resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined; // fail-closed：解析失败 = 无凭证
    }
  };
}
