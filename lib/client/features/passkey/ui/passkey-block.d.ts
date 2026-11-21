import { type AccountTranslate } from "../../../shared/i18n/index.ts";
export interface PasskeyBlockProps {
    /** 槽位注入的翻译 seat（含 `account.passkey.*` 键）。 */
    t: AccountTranslate;
    /** 当前账号是否开启两步验证：只影响动态码框的提示文案。 */
    totpEnabled?: boolean | undefined;
}
/**
 * 通行密钥区块：列表 + 添加/删除。
 *
 * `supported` 在渲染期算一次（特性检测是纯读操作），不支持时只隐藏添加入口，
 * 列表与删除仍可用。
 */
export declare function PasskeyBlock({ t, totpEnabled }: PasskeyBlockProps): import("react").JSX.Element;
