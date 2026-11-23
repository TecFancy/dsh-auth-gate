import { type AccountTranslate } from "../../../shared/i18n/index.ts";
export interface AccountSectionFooterProps {
    t: AccountTranslate;
    /** host 报上来的版本号；`undefined` = 不知道（旧 host / 读不到 package.json）。 */
    version?: string | undefined;
    /** 是否渲染星标：admin（password 模式）或 token 模式（运营者本人）。 */
    showStar: boolean;
}
export declare function AccountSectionFooter({ t, version, showStar }: AccountSectionFooterProps): import("react").JSX.Element | null;
