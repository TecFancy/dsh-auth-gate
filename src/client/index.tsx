import type { AuthContext } from "./context.ts";
import { LogoutAction } from "./logout-action.tsx";

/**
 * dsh-auth-gate client 半边：认证后在会话头部右上角（conversation.session.header.utilities，
 * session 作用域、可追加）挂一个纯图标登出入口。登出语义全部复用服务端冻结端点
 * （POST /auth/logout、GET /auth/status），本半边只负责渲染与门控。
 */
export const inject = ["slots"];

export function apply(ctx: AuthContext): void {
  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "dsh-auth-gate-logout",
        order: 10,
        label: "Sign out",
      },
      LogoutAction,
    ),
  );
}
