import { type PasskeyFailureView } from "../model/passkey-form.ts";
/**
 * 状态区：失败消息（错误色）+ 就地成功文案（成功色），常驻 aria-live 播报位。
 *
 * `tabIndex={-1}`：没有字段落点的失败（403/429/503 等）把焦点送到这里，
 * 读屏用户不用自己找（C6）。
 */
export declare function PasskeyStatus({ failure, success, }: {
    failure: PasskeyFailureView | null;
    success: string | null;
}): import("react").JSX.Element;
