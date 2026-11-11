import { formField } from "../../../shared/http/index.js";
/**
 * 单个 base64url 字段的字符上限（16 KiB）。**不是**安全边界：整个表单体由
 * `parseFormBody` 限 `FORM_BODY_LIMIT`，这里只给库的解析成本一个显式上限。
 */
export const PASSKEY_FIELD_MAX_CHARS = 16 * 1024;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
/** 无填充 base64url 且长度在 `(0, maxChars]` 内。 */
export function isBase64Url(value) {
    return value.length > 0 && value.length <= PASSKEY_FIELD_MAX_CHARS && BASE64URL_RE.test(value);
}
/**
 * 从表单体读断言：缺 `id`/`client_data_json`/`authenticator_data`/`signature` 之一、
 * 超限、或不是 base64url → `undefined`（端点一律回同一个 401，不区分缺哪个字段）。
 * `user_handle` 时间接决定「凭据属主」判定，缺席返回 `undefined`。
 */
export function readPasskeyAssertion(params) {
    const id = formField(params, "id");
    const clientDataJSON = formField(params, "client_data_json");
    const authenticatorData = formField(params, "authenticator_data");
    const signature = formField(params, "signature");
    if (![id, clientDataJSON, authenticatorData, signature].every(isBase64Url))
        return undefined;
    const userHandle = formField(params, "user_handle");
    if (userHandle !== "" && !isBase64Url(userHandle))
        return undefined;
    return {
        id,
        clientDataJSON,
        authenticatorData,
        signature,
        userHandle: userHandle === "" ? undefined : userHandle,
    };
}
/**
 * 在全部用户的 `passkeys[]` 里按 `credentialId` 找凭据。名字不是凭据输入（无用户名登录），
 * 所以这里只能全表找：未命中 = 未知凭据，端点等量工作后回同一个 401。
 */
export function findPasskeyCredential(snapshot, credentialId) {
    for (const [username, user] of snapshot.users) {
        for (const record of user.passkeys ?? []) {
            if (record.credentialId === credentialId)
                return { username, user, record };
        }
    }
    return undefined;
}
/** 从 `authenticatorData` 读认证器计数器（固定 offset 33..37，大端）；短于 37 字节 → undefined。 */
export function readAuthenticatorCounter(authenticatorData) {
    const bytes = Buffer.from(authenticatorData, "base64url");
    return bytes.length < 37 ? undefined : bytes.readUInt32BE(33);
}
/**
 * 登录计数器策略（§5.8）：`reported === 0`（认证器不支持计数器）或 `stored === 0`
 * （首次使用）跳过；前进值交给库正常校验；**回退**只在设备绑定凭据且 `enforce` 时拒绝，
 * 否则放行（传 `counter: 0` 绕过库内的严格回退检查）并让端点记 warn。
 * `reported === stored > 0` 视为重放：交给库拒绝（库对 `<=` 抛错）。
 */
export function selectVerificationCounter(input) {
    const { stored, reported, enforce, deviceBound } = input;
    if (reported === undefined || reported === 0 || stored === 0) {
        return { counter: 0, rejection: undefined, warn: undefined };
    }
    if (reported > stored)
        return { counter: stored, rejection: undefined, warn: undefined };
    if (reported < stored) {
        if (enforce && deviceBound)
            return { counter: 0, rejection: "counter-regression", warn: undefined };
        return { counter: 0, rejection: undefined, warn: "counter-regression" };
    }
    return { counter: stored, rejection: undefined, warn: undefined };
}
/**
 * `BE`/`BS` 登录一致性：库从认证器数据解析出的设备类别/备份状态必须与注册时记录一致。
 * 不一致意味着「同一 credentialId 在别的设备/备份状态上出现」，拒绝（§5.6 第 4 条）。
 */
export function backupStateMatches(record, credentialDeviceType, credentialBackedUp) {
    return (credentialDeviceType === "multiDevice") === record.be && credentialBackedUp === record.bs;
}
/**
 * 进程内计数器（§5.4：默认只存内存、不随每次登录写盘）。进程重启后回落到
 * `users.yaml` 的快照值；因此它只是尽力检测，不是克隆防护承诺。
 */
export class PasskeyCounterStore {
    counters = new Map();
    /** 当前生效值：进程内更新优先，否则用读盘快照。 */
    stored(record) {
        return this.counters.get(record.credentialId) ?? record.signCount;
    }
    /** 只在前进时更新进程内值；返回更新后的生效值。 */
    advance(record, reported) {
        const current = this.stored(record);
        if (reported <= current)
            return current;
        this.counters.set(record.credentialId, reported);
        return reported;
    }
}
//# sourceMappingURL=passkey-login.js.map