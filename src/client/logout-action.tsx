import { useEffect, useState, type CSSProperties } from "react";

/** 登出按钮的可访问名（纯图标、无可见文字，按钮以 aria-label 命名）。 */
const SIGN_OUT_LABEL = "Sign out";

/** 登出目标：POST-only（M22：next 仅从 query 取，校验回落 /）。 */
const LOGOUT_TARGET = "/auth/logout?next=/";

/** 登出图标：16px，与对话头部工具栏（Session log）图标尺寸一致。 */
function renderLogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/**
 * hover 态背景色：引用 shell 交互元素的 hover token
 * `var(--dsw-alias-interactive-bg-hover)`（浅色主题解析为 rgba(38, 49, 72, .06)，
 * 深色主题为 rgba(255, 255, 255, .08)），与 Session log / 图标按钮随主题一致。
 */
const HOVER_BACKGROUND = "var(--dsw-alias-interactive-bg-hover)";

/** 与对话头部 Session log 按钮同一套 surface 语言：32px 圆形图标按钮。 */
const BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  padding: 0,
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: "50%",
  color: "var(--dsw-alias-label-primary)",
  cursor: "pointer",
  boxSizing: "border-box",
};

const formStyle: CSSProperties = {
  display: "contents",
};

/**
 * 会话状态门控：挂载时 fetch /auth/status 一次（只认 cookie）。
 * @returns authenticated：null = 未知（第一次请求前），true/false。
 */
function useAuthenticated(): boolean | null {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/auth/status")
      .then((res) => res.json())
      .then((body: { authenticated?: unknown }) => {
        if (!cancelled) setAuthenticated(body.authenticated === true);
      })
      .catch(() => {
        if (!cancelled) setAuthenticated(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return authenticated;
}

/** 可复用的登出提交按钮：原生 form POST（零 JS 依赖）+ 纯图标 + 主题 hover。 */
function LogoutSubmitButton() {
  const [hovered, setHovered] = useState(false);
  return (
    <form method="post" action={LOGOUT_TARGET} style={formStyle}>
      <button
        type="submit"
        aria-label={SIGN_OUT_LABEL}
        title={SIGN_OUT_LABEL}
        style={{
          ...BUTTON_STYLE,
          background: hovered ? HOVER_BACKGROUND : "transparent",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {renderLogoutIcon()}
      </button>
    </form>
  );
}

/** 会话头部右上角登出入口（conversation.session.header.utilities，session 作用域）。 */
export function LogoutAction() {
  const authenticated = useAuthenticated();
  if (authenticated !== true) return null;
  return <LogoutSubmitButton />;
}

/**
 * 新会话页（hero 空态）右上角的浮动登出入口：root 级 shell.overlay 注册，
 * 仅当没有当前会话（SessionListState.current === undefined）且已认证时渲染，
 * 与会话头部入口互斥、不重复。
 */
export interface HeroLogoutActionProps {
  /** root 槽位 standard hook：selector 读取会话快照。缺席或非函数时按"无当前会话"处理。 */
  useSessions?: (
    selector: (state: { current?: string }) => string | undefined,
  ) => string | undefined;
}

export function HeroLogoutAction({ useSessions }: HeroLogoutActionProps) {
  const authenticated = useAuthenticated();
  const current =
    typeof useSessions === "function" ? useSessions((state) => state.current) : undefined;
  if (authenticated !== true || current !== undefined) return null;
  const floatingWrap: CSSProperties = {
    position: "fixed",
    top: 14,
    right: 16,
    zIndex: 1,
    pointerEvents: "auto",
  };
  return (
    <div style={floatingWrap}>
      <LogoutSubmitButton />
    </div>
  );
}
