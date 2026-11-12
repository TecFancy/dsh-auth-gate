import { formField } from "../../../shared/http/index.js";
import { passkeyManagementGate } from "./passkey-management-gate.js";
import { sendPasskeyError, sendPasskeyJson } from "./passkey-management-http.js";
/** 条件 UI 开关的合法取值（表单字符串）。 */
const CONDITIONAL_UI_VALUES = { "1": true, "0": false };
/** `GET /auth/passkey/settings`：门禁（GET）→ admin 校验 → 200 当前值。 */
export async function handlePasskeySettingsGet(deps, req, res) {
    const gate = await passkeyManagementGate(deps, req, res, {
        method: "GET",
        form: false,
        origin: false,
        limiter: false,
    });
    if (gate.kind === "handled")
        return;
    if (gate.context.authed.user.role !== "admin") {
        sendPasskeyError(res, 403, "forbidden");
        return;
    }
    const body = {
        conditionalUiEnabled: deps.management.conditionalUi(),
    };
    sendPasskeyJson(res, 200, body);
}
/** `POST /auth/passkey/settings`：门禁（POST + 表单）→ admin 校验 → 取值校验 → 写回 → 200。 */
export async function handlePasskeySettingsPost(deps, req, res) {
    const gate = await passkeyManagementGate(deps, req, res, {
        method: "POST",
        form: true,
        origin: true,
        limiter: false,
    });
    if (gate.kind === "handled")
        return;
    if (gate.context.authed.user.role !== "admin") {
        sendPasskeyError(res, 403, "forbidden");
        return;
    }
    const raw = formField(gate.context.params, "conditionalUi");
    const enabled = CONDITIONAL_UI_VALUES[raw];
    if (enabled === undefined) {
        sendPasskeyError(res, 400, "bad_request", "invalid-conditional-ui");
        return;
    }
    try {
        await deps.management.persistConditionalUi(enabled);
    }
    catch (error) {
        // 持久化失败不改内存值、也不改 200 语义：开关是偏好，不是安全边界。
        deps.logger.error(`passkey settings: persist failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const body = { conditionalUiEnabled: enabled };
    sendPasskeyJson(res, 200, body);
    deps.logger.info(`passkey settings: conditional UI ${enabled ? "enabled" : "disabled"}`);
}
//# sourceMappingURL=passkey-settings-endpoints.js.map