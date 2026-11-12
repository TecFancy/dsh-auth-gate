/**
 * passkey 管理面 API 的共享小件：JSON 读取与对象守卫。
 *
 * 单独成文件是为了让 list / mutate / settings 三个 API 文件都短于 250 行，
 * 且不互相 import（同层文件之间只共享这一个叶子）。
 */
/** 对象守卫：只用于读未校验的 JSON。 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** 读 JSON；非对象或解析失败统一回空体（映射只看状态码）。 */
export declare function readJsonSafe(res: Response): Promise<unknown>;
//# sourceMappingURL=passkey-http.d.ts.map