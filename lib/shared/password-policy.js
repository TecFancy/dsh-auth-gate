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
export const PASSWORD_MIN_LENGTH = 14;
/** 最长长度（P1）：防超长输入拖 scrypt，413 只是请求级兜底。 */
export const PASSWORD_MAX_LENGTH = 256;
/** 四类字符判定：大写 / 小写 / 数字 / 非字母数字（空格算 special）。 */
function missingCharacterRules(newPassword) {
    const rules = [];
    if (!/[A-Z]/.test(newPassword))
        rules.push("uppercase");
    if (!/[a-z]/.test(newPassword))
        rules.push("lowercase");
    if (!/[0-9]/.test(newPassword))
        rules.push("digit");
    if (!/[^A-Za-z0-9]/.test(newPassword))
        rules.push("special");
    return rules;
}
/** 长度规则（长度不过 → 调用方短路，不再跑字符类与旧哈希）。 */
function lengthRules(newPassword) {
    const rules = [];
    if (newPassword.length < PASSWORD_MIN_LENGTH)
        rules.push("minLength");
    if (newPassword.length > PASSWORD_MAX_LENGTH)
        rules.push("maxLength");
    return rules;
}
/**
 * 校验新口令。返回未通过项（空数组 = 通过）；`rules` 顺序固定为枚举声明顺序。
 * `oldPasswordHash` 与 `verifyOld` 必须同时给出才会跑 sameAsOld。
 */
export async function checkPasswordPolicy(newPassword, opts = {}) {
    const rules = [...lengthRules(newPassword), ...missingCharacterRules(newPassword)];
    if (rules.length > 0)
        return { ok: false, rules };
    const { oldPasswordHash, verifyOld } = opts;
    if (oldPasswordHash !== undefined && verifyOld !== undefined) {
        if (await verifyOld(newPassword, oldPasswordHash))
            rules.push("sameAsOld");
    }
    return { ok: rules.length === 0, rules };
}
//# sourceMappingURL=password-policy.js.map