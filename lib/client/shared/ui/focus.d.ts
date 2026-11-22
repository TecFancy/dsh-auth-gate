/**
 * 失败落点的共享小件：改密 / 管理重置 / 通行密钥三块表单同一套焦点纪律。
 *
 * 各自有字段顺序与 id 前缀，所以这里只共享「按文档顺序找第一个错误字段，
 * 没有字段错误就落到状态播报位」这一段；查找用的 id 由调用方给。
 */
/** 一次失败要聚焦的目标；`Field` 由 `order` / `elementId` 收窄到该表单自己的字段集。 */
export interface FailureFocusTarget<Field extends string> {
    /** 本次失败需要标红的字段（可以含不在本表单顺序里的字段，会被忽略）。 */
    fields: readonly string[];
    /** 字段的文档顺序：失败后按这个顺序找第一个错误字段。 */
    order: readonly Field[];
    /** 字段 → DOM id。 */
    elementId: (field: Field) => string;
    /** 无字段错误时的落点（带 `tabIndex=-1` 的状态播报位）。 */
    statusId: string;
}
/** 把焦点送到第一个出错字段；没有字段错误时送到状态播报位。 */
export declare function focusFailureTarget<Field extends string>(target: FailureFocusTarget<Field>): void;
