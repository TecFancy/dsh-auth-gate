import { ACCOUNT_KEYS, type AccountTranslate } from "../../../shared/i18n/index.ts";
import { FOOTER_LINK_STYLE, FOOTER_STYLE, FOOTER_VERSION_STYLE } from "../../../shared/ui/index.ts";

/**
 * 页脚（2026-11-23）：版本行 + 可选的星标入口。
 *
 * 三条硬约束（改动前先读）：
 * 1. **版本号来自 host**，不是前端构建常量。设置页是浏览器里跑的 bundle，插件升级后页面
 *    可能还在跑缓存的旧 bundle；那时前端常量会报一个已经不在机器上的版本。`version`
 *    缺失（旧 host / 读不到 package.json）时**整条版本行不渲染**，绝不显示一个空的 `v`。
 * 2. **星标只给运营者看**。password 模式下这一页每个登录用户都能打开，普通用户是部署者的
 *    同事而不是本项目的受众；`token` 模式没有角色，但只有持共享令牌的人能走到这里，那正是
 *    装插件的人。`mode` 缺失（旧 host）按「不知道」处理，退回 admin-only，不反推模式。
 * 3. **零副作用**：不发请求、不读存储、不做「下次再说」的持久化、不做常驻动画。
 *    一次渲染、一次点击，点击后交给浏览器新开标签页。
 */

/** 仓库地址：文案在词典里，链接只在这里出现一次。 */
const REPO_URL = "https://github.com/TecFancy/dsh-auth-gate";

export interface AccountSectionFooterProps {
  t: AccountTranslate;
  /** host 报上来的版本号；`undefined` = 不知道（旧 host / 读不到 package.json）。 */
  version?: string | undefined;
  /** 是否渲染星标：admin（password 模式）或 token 模式（运营者本人）。 */
  showStar: boolean;
}

export function AccountSectionFooter({ t, version, showStar }: AccountSectionFooterProps) {
  // 空串与 undefined 同义：host 读不到 package.json 时写空串，不能渲染成一个孤零零的 `v`。
  const known = version === undefined || version === "" ? undefined : version;
  if (known === undefined && !showStar) return null;
  return (
    <footer style={FOOTER_STYLE}>
      {known === undefined ? null : (
        <span style={FOOTER_VERSION_STYLE} title={known}>
          {t(ACCOUNT_KEYS.footerVersion, { version: known })}
        </span>
      )}
      {showStar ? (
        <a
          style={FOOTER_LINK_STYLE}
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          title={t(ACCOUNT_KEYS.starHint)}
        >
          {t(ACCOUNT_KEYS.starCta)}
        </a>
      ) : null}
    </footer>
  );
}
