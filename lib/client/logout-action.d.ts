/** 会话头部右上角登出入口（conversation.session.header.utilities，session 作用域）。 */
export declare function LogoutAction(): import("react").JSX.Element | null;
/**
 * 新会话页（hero 空态）右上角的浮动登出入口：root 级 shell.overlay 注册，
 * 仅当没有当前会话（SessionListState.current === undefined）且已认证时渲染，
 * 与会话头部入口互斥、不重复。
 */
export interface HeroLogoutActionProps {
    /** root 槽位 standard hook：selector 读取会话快照。缺席或非函数时按"无当前会话"处理。 */
    useSessions?: (selector: (state: {
        current?: string;
    }) => string | undefined) => string | undefined;
}
export declare function HeroLogoutAction({ useSessions }: HeroLogoutActionProps): import("react").JSX.Element | null;
//# sourceMappingURL=logout-action.d.ts.map