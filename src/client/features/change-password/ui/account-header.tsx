/**
 * 改密区的标题行 + 账号上下文（重设计 2026-11-16）。
 *
 * 从 `account-form.tsx` 拆出来的原因有两个：那个文件已经 231 行，再塞上下文行会撞
 * 250 行红线；更重要的是**上下文行不属于表单**：它回答「我是谁」，表单回答「改什么」，
 * 拆开后表单卸载（成功态）时上下文仍在。
 *
 * 注意：这里**不包 `<section>`**。`account-section.test.tsx` 有一条断言拿
 * `container.querySelector("section")` 的第一个结果读 `minHeight`，那个第一个必须是
 * 改密面板本身。包一层 section 会让那条断言读到 undefined。
 */
import { ACCOUNT_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import {
  ACCOUNT_CONTEXT_NAME_STYLE,
  ACCOUNT_CONTEXT_STYLE,
  ACCOUNT_ICON_PATHS,
  ACCOUNT_ICON_VIEW_BOX,
  ADMIN_BADGE_STYLE,
  HINT_STYLE,
  TITLE_ROW_STYLE,
} from "../../../shared/ui/index.ts";

/**
 * 本插件自设计的图标（P1.1 / D24）：盾 + 钥匙孔，16px outline。
 *
 * 内容区标题行这一份是**我们自己的 React 树**：不依赖宿主任何内部结构，可测、可卸载。
 * 导航行那一份由 `account-nav-icon.ts` 的临时 DOM 垫片贴上去（宿主没有 `icon` 挂载点，
 * 见 D24.1）。两处共用 `account-icon.ts` 的路径数据，与 `docs/demo/account-security.svg` 同源。
 */
export function AccountIcon() {
  return (
    <svg
      viewBox={ACCOUNT_ICON_VIEW_BOX}
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ACCOUNT_ICON_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** 账号上下文：只显示服务端确实给了的字段，缺字段不画空徽标。 */
export interface AccountContextProps {
  t: AccountTranslate;
  /** `/auth/status` 的 `name`；旧服务端可能没有。 */
  name?: string | undefined;
  /** `/auth/status` 的 `role`；缺失时不推断成 user。 */
  role?: "admin" | "user" | undefined;
  /** `/auth/status` 的 `totpEnabled`；缺失时不推断成关闭。 */
  totpEnabled?: boolean | undefined;
}

/** 角色 / 两步验证的文案键（未知取值不显示，不发明文案）。 */
function roleKey(role: "admin" | "user"): string {
  return role === "admin" ? ACCOUNT_KEYS.roleAdmin : ACCOUNT_KEYS.roleUser;
}

/**
 * 账号上下文行：`本地账号 <name> [角色] [两步验证]`。
 *
 * 三个字段全缺时整行不渲染（旧服务端只回 `authenticated` 的情况），不占位。
 */
export function AccountContext({ t, name, role, totpEnabled }: AccountContextProps) {
  if (name === undefined && role === undefined && totpEnabled === undefined) return null;
  const badges: string[] = [];
  if (role !== undefined) badges.push(t(roleKey(role)));
  if (totpEnabled !== undefined) {
    badges.push(t(totpEnabled ? ACCOUNT_KEYS.totpOn : ACCOUNT_KEYS.totpOff));
  }
  return (
    <div style={ACCOUNT_CONTEXT_STYLE}>
      <span>{t(ACCOUNT_KEYS.contextLocal)}</span>
      {name === undefined ? null : <span style={ACCOUNT_CONTEXT_NAME_STYLE}>{name}</span>}
      {badges.map((text) => (
        <span key={text} style={ADMIN_BADGE_STYLE}>
          {text}
        </span>
      ))}
    </div>
  );
}

/** 改密区标题行：图标 + 标题 + 两句说明（后果 / 作用域）。 */
export interface AccountHeaderProps {
  t: AccountTranslate;
  /** 成功态只留标题，不重复说明。 */
  showIntro?: boolean;
}

/** 标题行 + 说明。`h2` 与 16×16 `aria-hidden` svg 是既有测试钉住的形状，不能改。 */
export function AccountHeader({ t, showIntro = true }: AccountHeaderProps) {
  return (
    <>
      <h2 style={TITLE_ROW_STYLE}>
        <AccountIcon />
        {t(ACCOUNT_KEYS.title)}
      </h2>
      {showIntro ? (
        <>
          <p style={HINT_STYLE}>{t(ACCOUNT_KEYS.intro)}</p>
          <p style={HINT_STYLE}>{t(ACCOUNT_KEYS.scope)}</p>
        </>
      ) : null}
    </>
  );
}
