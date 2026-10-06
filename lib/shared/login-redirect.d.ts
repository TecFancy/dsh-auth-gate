/** launch-token 桥的最小契约：给出登录成功后的 Location，`undefined` 表示本次没有可用的桥。 */
export type LaunchTokenBridge = () => Promise<string | undefined>;
/**
 * 登录成功后的 Location 解析（token 与 password 两条成功路径共用，issue #99 的根因就是这两条
 * 路径各写一份而漂移）。
 *
 * 契约：桥只影响「成功之后的跳转目标」，永远不会把一次成功的登录变成错误。因此
 * 桥未配置 / 返回 `undefined`（桥自己已按闩告警）→ 静默回落 `next`；桥抛错、或返回的不是
 * 站内安全相对地址（`//evil`、绝对 URL、控制符、空串）→ 回落 `next` 并告警；连告警本身
 * 抛错也被吞掉，因为日志不该有能力打断已经成立的登录跳转。
 */
export declare function resolvePostLoginLocation(bridge: LaunchTokenBridge | undefined, next: string, logger: {
    warn?(message: unknown): void;
}): Promise<string>;
//# sourceMappingURL=login-redirect.d.ts.map