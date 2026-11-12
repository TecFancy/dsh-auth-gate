/**
 * `GET/POST /auth/passkey/settings`（admin）：登录页条件 UI（passkey 自动填充）开关。
 *
 * GET 返回当前值；POST 只接受 `conditionalUi` = `"1"` / `"0"`（其它值 400），写回宿主
 * settings 服务。**持久化失败只记日志、仍回 200**：开关是可用性偏好，不是安全边界，
 * 写盘失败不该让管理员看到「保存失败」而反复重试。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { formField } from "../../../shared/http/index.js";
import type {
  PasskeySettingsRequest,
  PasskeySettingsResponse,
} from "../../../shared/protocol/index.js";
import type { PasskeyManagementDeps } from "./passkey-management-deps.js";
import { passkeyManagementGate } from "./passkey-management-gate.js";
import { sendPasskeyError, sendPasskeyJson } from "./passkey-management-http.js";

/** 条件 UI 开关的合法取值（表单字符串）。 */
const CONDITIONAL_UI_VALUES: Readonly<Record<string, boolean>> = { "1": true, "0": false };

/** `GET /auth/passkey/settings`：门禁（GET）→ admin 校验 → 200 当前值。 */
export async function handlePasskeySettingsGet(
  deps: PasskeyManagementDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const gate = await passkeyManagementGate(deps, req, res, {
    method: "GET",
    form: false,
    origin: false,
    limiter: false,
  });
  if (gate.kind === "handled") return;
  if (gate.context.authed.user.role !== "admin") {
    sendPasskeyError(res, 403, "forbidden");
    return;
  }
  const body: PasskeySettingsResponse = {
    conditionalUiEnabled: deps.management.conditionalUi(),
  };
  sendPasskeyJson(res, 200, body);
}

/** `POST /auth/passkey/settings`：门禁（POST + 表单）→ admin 校验 → 取值校验 → 写回 → 200。 */
export async function handlePasskeySettingsPost(
  deps: PasskeyManagementDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const gate = await passkeyManagementGate(deps, req, res, {
    method: "POST",
    form: true,
    origin: true,
    limiter: false,
  });
  if (gate.kind === "handled") return;
  if (gate.context.authed.user.role !== "admin") {
    sendPasskeyError(res, 403, "forbidden");
    return;
  }
  const raw = formField<PasskeySettingsRequest>(gate.context.params, "conditionalUi");
  const enabled = CONDITIONAL_UI_VALUES[raw];
  if (enabled === undefined) {
    sendPasskeyError(res, 400, "bad_request", "invalid-conditional-ui");
    return;
  }
  try {
    await deps.management.persistConditionalUi(enabled);
  } catch (error) {
    // 持久化失败不改内存值、也不改 200 语义：开关是偏好，不是安全边界。
    deps.logger.error(
      `passkey settings: persist failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const body: PasskeySettingsResponse = { conditionalUiEnabled: enabled };
  sendPasskeyJson(res, 200, body);
  deps.logger.info(`passkey settings: conditional UI ${enabled ? "enabled" : "disabled"}`);
}
