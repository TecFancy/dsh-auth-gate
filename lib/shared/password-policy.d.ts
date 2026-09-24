/**
 * 口令策略（P1 §2）：shared 叶子层，纯函数 + 注入比较器。
 *
 * 为什么旧口令比较要注入：策略模块在 shared 层，而 `verifyPassword` 住在
 * `features/password`，shared 不得 import 上层（§0 硬规则），故 `sameAsOld`
 * 由调用方把「现口令哈希 + 验证函数」传进来。
 *
 * 顺序冻结：长度 → 字符类 → 旧哈希（最贵最后）。任何前置规则不过都直接短路，
 * 不跑最贵的 scrypt 比较（长度不过不跑旧哈希是契约明写的下界，字符类同理）。
 * 不做 trim、不做截断、不做 NFKC：口令按用户输入的原始码点判定。
 */
/** 最短长度（P1）。 */
export declare const PASSWORD_MIN_LENGTH = 14;
/** 最长长度（P1）：防超长输入拖 scrypt，413 只是请求级兜底。 */
export declare const PASSWORD_MAX_LENGTH = 256;
/** 未通过项枚举（值即线上 `rules` 数组元素，顺序同下）。 */
export type PasswordRule = "minLength" | "maxLength" | "uppercase" | "lowercase" | "digit" | "special" | "sameAsOld";
export interface PasswordPolicyResult {
    ok: boolean;
    /** 未通过项，按枚举声明顺序。 */
    rules: PasswordRule[];
}
export interface PasswordPolicyOptions {
    /** 同一用户的现口令哈希；缺省 = 不做 sameAsOld 判定。 */
    oldPasswordHash?: string;
    /** 现口令比较器（index.ts 注入 verifyPassword）；缺省 = 跳过 sameAsOld。 */
    verifyOld?: (plain: string, hash: string) => Promise<boolean>;
}
/**
 * 校验新口令。返回未通过项（空数组 = 通过）；`rules` 顺序固定为枚举声明顺序。
 * `oldPasswordHash` 与 `verifyOld` 必须同时给出才会跑 sameAsOld。
 */
export declare function checkPasswordPolicy(newPassword: string, opts?: PasswordPolicyOptions): Promise<PasswordPolicyResult>;
//# sourceMappingURL=password-policy.d.ts.map