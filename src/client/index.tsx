import type { AuthContext } from "./context.ts";
import { HeroLogoutAction, LogoutAction } from "./logout-action.tsx";

/**
 * dsh-auth-gate client 半边：认证后在 GUI 右上角挂一个纯图标登出入口（同一套
 * POST /auth/logout + GET /auth/status 语义）。两处注册互补、作用域互斥：
 *
 * - `conversation.session.header.utilities`（session 作用域）：会话头部右上角，
 *   Session log 右侧——会话页面使用；
 * - `shell.overlay`（root 作用域）+ 无当前会话门控：**新会话页**（hero 空态）
 *   没有会话头部，此时在窗口右上角浮动显示同一按钮。
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
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-auth-gate-logout-hero",
        order: 10,
        label: "Sign out (hero)",
      },
      HeroLogoutAction,
    ),
  );
}
