/**
 * passkey 区块的状态播报位（共享展示件）。
 *
 * 只被 `passkey-block.tsx` import；本文件不 import 它（避免循环）。样式全部复用
 * `shared/ui` 的既有常量，不新增视觉语言。
 */
import { ERROR_TEXT_STYLE, STATUS_STYLE, SUCCESS_TEXT_STYLE } from "../../../shared/ui/index.ts";
import { PASSKEY_STATUS_ID, type PasskeyFailureView } from "../model/passkey-form.ts";

/**
 * 状态区：失败消息（错误色）+ 就地成功文案（成功色），常驻 aria-live 播报位。
 *
 * `tabIndex={-1}`：没有字段落点的失败（403/429/503 等）把焦点送到这里，
 * 读屏用户不用自己找（C6）。
 */
export function PasskeyStatus({
  failure,
  success,
}: {
  failure: PasskeyFailureView | null;
  success: string | null;
}) {
  return (
    <div id={PASSKEY_STATUS_ID} role="status" aria-live="polite" tabIndex={-1} style={STATUS_STYLE}>
      {failure === null ? null : <span style={ERROR_TEXT_STYLE}>{failure.message}</span>}
      {success === null ? null : <span style={SUCCESS_TEXT_STYLE}>{success}</span>}
    </div>
  );
}
