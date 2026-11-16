/**
 * 改密表单的字段与状态区（重设计 2026-11-16：改成宿主设置页的行式布局）。
 *
 * 结构钉点（测试依赖，不能改）：四个 input 的 `name` 与顺序是
 * `current` / `password` / `confirm` / `code`；`ACCOUNT_STATUS_ID` 是常驻
 * `role="status" aria-live="polite"` 节点，也是错误字段 `aria-describedby` 的落点。
 *
 * 重设计新增：新密码框下常驻策略说明（原来只在失败后才说）、动态码提示按
 * `totpEnabled` 状态化（原来恒说「已开启时填写」，未开启的用户会以为要填）。
 */
import { type AccountTranslate } from "../../../shared/i18n/index.ts";
import type { FailureView, FieldName, FormValues } from "../model/account-submit.ts";
/** 状态区 id：aria-live 播报位，也是错误字段 aria-describedby 的落点（成功态复用）。 */
export declare const ACCOUNT_STATUS_ID = "dsh-auth-gate-account-status";
interface PasswordFieldsProps {
    t: AccountTranslate;
    values: FormValues;
    isInvalid: (field: FieldName) => boolean;
    onChange: (field: FieldName, value: string) => void;
    /** 请求在飞：四个输入只读。 */
    readOnly?: boolean | undefined;
    /**
     * 当前账号是否开启两步验证。`undefined` = 不知道（旧服务端），此时沿用
     * 「已开启时填写」的保守文案，不推断成关闭。
     */
    totpEnabled?: boolean | undefined;
}
/** 四字段（current / password / confirm / code），autocomplete 按语义固定。 */
export declare function PasswordFields({ t, values, isInvalid, onChange, readOnly, totpEnabled, }: PasswordFieldsProps): import("react").JSX.Element;
/**
 * 状态区：常驻 DOM 的 aria-live 播报位（idle 时留空，避免读屏漏播）。
 *
 * `tabIndex={-1}` 让无字段的全局错误（429 / 503 / 网络）能把焦点落到这里，
 * 读屏用户不用自己找（评审 F4 的焦点落点）。
 */
export declare function StatusLine({ failure }: {
    failure: FailureView | null;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=account-fields.d.ts.map