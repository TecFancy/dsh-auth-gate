/**
 * `next` 校验（M8+M20）与 Location 消毒（P2 复审）共用判定：单个 `/` 开头、
 * 非 `//` 开头、不含 `\`、不含控制符。`validateNext` 另加「不是 `/auth` 或
 * `/auth/*`」（防登录后 302 回环）；否则回落 `/`。token 与 password 两个端点流共用。
 */
export declare function isSafeRelativeTarget(target: string): boolean;
export declare function validateNext(next: string): string;
//# sourceMappingURL=auth-common.d.ts.map