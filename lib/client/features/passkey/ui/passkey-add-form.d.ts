import { type AccountTranslate } from "../../../shared/i18n/index.ts";
import type { PasskeyField, PasskeyFormValues } from "../model/passkey-form.ts";
export interface PasskeyAddFormProps {
    t: AccountTranslate;
    values: PasskeyFormValues;
    invalid: PasskeyField[];
    busy: boolean;
    onChange: (field: PasskeyField, value: string) => void;
    /** 提交回调：父组件的状态机自己吞掉 Promise（表单只负责触发）。 */
    onSubmit: () => void | Promise<void>;
}
/** 添加表单：提交由父组件的状态机接管（校验、双锁、abort 都在那里）。 */
export declare function PasskeyAddForm({ t, values, invalid, busy, onChange, onSubmit, }: PasskeyAddFormProps): import("react").JSX.Element;
//# sourceMappingURL=passkey-add-form.d.ts.map