/**
 * 跨半边契约（D31）的载荷半边：`/auth/*` 端点的请求体、响应体与错误体形状。
 *
 * 只放纯类型（编译后整个文件消失），不 import 任何东西。host 写出与解析、client 发送与解析
 * 都以这里为准：host 的写出点按这些类型收窄（写错键或错误码编译不过），client 的解析器按
 * `Unchecked<T>` 读键（读错键编译不过）。运行期仍由 client 逐字段校验，类型不替代校验。
 *
 * 改这里就是改对外契约：已部署的旧 client 只认旧形状，响应只能加法演进。
 */
export {};
//# sourceMappingURL=payloads.js.map