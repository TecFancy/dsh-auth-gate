/**
 * 「通行密钥」区块（M6 PR3）：挂在「账号安全」设置页的已登录分支。
 *
 * 结构：标题 + 说明 + 列表（或空态）+ 添加表单 + 状态播报位。
 * 特性检测：`window.PublicKeyCredential` 不存在时**隐藏添加按钮**（列表照常显示，
 * 用户仍能看到/删除已有凭据）；无 JS 时整块不渲染（React 组件，本来就需要 JS）。
 */
import { type AccountTranslate } from "../../../shared/i18n/index.ts";
export interface PasskeyBlockProps {
    /** 槽位注入的翻译 seat（含 `account.passkey.*` 键）。 */
    t: AccountTranslate;
}
/**
 * 通行密钥区块：列表 + 添加/删除。`supported` 在渲染期算一次（特性检测是纯读操作），
 * 不支持时只隐藏添加表单，列表与删除仍可用。
 */
export declare function PasskeyBlock({ t }: PasskeyBlockProps): import("react").JSX.Element;
//# sourceMappingURL=passkey-block.d.ts.map