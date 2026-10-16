/**
 * 把一个请求体对象编码成 `application/x-www-form-urlencoded`。调用方先把对象标注成
 * `src/protocol/` 里的请求体类型（`PasswordChangeRequest` / `AdminResetRequest`），键名就受契约
 * 约束；值为 `undefined` 的可选字段不发送，字段顺序同对象字面量。
 */
export declare function encodeForm<T extends {
    [K in keyof T]?: string | undefined;
}>(fields: T): URLSearchParams;
//# sourceMappingURL=form.d.ts.map