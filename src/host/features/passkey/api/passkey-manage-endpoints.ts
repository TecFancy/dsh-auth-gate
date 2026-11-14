/**
 * `GET /auth/passkey`（自己的凭据列表）与 `POST /auth/passkey/remove`（删除）。
 *
 * 列表只出 `PasskeySummary`（id 前缀 + 展示字段），绝不返回 `publicKeyCose` 或
 * `passkeyUserHandle`。删除按 credentialId 前缀唯一匹配；`all=1` 清空。**删最后一把或
 * `all=1` 必须再认证**（口令 + 条件 TOTP 码），否则会话被劫即可把用户锁在门外。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { formField } from "../../../shared/http/index.js";
import type { PasskeyListResponse, PasskeyRemoveRequest } from "../../../shared/protocol/index.js";
import {
  matchCredentialPrefix,
  sortPasskeysByCreatedAt,
  toPasskeySummary,
} from "../model/passkey-management.js";
import type { PasskeyManagementDeps } from "./passkey-management-deps.js";
import { passkeyManagementGate } from "./passkey-management-gate.js";
import {
  reauthenticate,
  sendPasskeyError,
  sendPasskeyJson,
  sendPasskeyStoreUnavailable,
} from "./passkey-management-http.js";

/** `GET /auth/passkey`：门禁（GET、无表单、不查限速桶）→ 200 列表（createdAt 升序）。 */
export async function handlePasskeyList(
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
  const records = sortPasskeysByCreatedAt(gate.context.authed.user.passkeys ?? []);
  const body: PasskeyListResponse = { passkeys: records.map(toPasskeySummary) };
  sendPasskeyJson(res, 200, body);
}

/** 删除请求的已解析输入。 */
interface RemoveInput {
  readonly all: boolean;
  readonly id: string;
  readonly password: string;
  readonly code: string;
}

/**
 * `POST /auth/passkey/remove`：门禁 → 目标解析（404 / 400）→ 条件再认证 → 锁内删除 → 200。
 * 再认证只在 `all=1` 或「删后该用户凭据数为 0」时要求；普通单删只凭会话。
 */
export async function handlePasskeyRemove(
  deps: PasskeyManagementDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const gate = await passkeyManagementGate(deps, req, res, {
    method: "POST",
    form: true,
    origin: true,
    limiter: true,
  });
  if (gate.kind === "handled") return;
  const { authed, params, ip } = gate.context;
  const input: RemoveInput = {
    all: formField<PasskeyRemoveRequest>(params, "all") === "1",
    id: formField<PasskeyRemoveRequest>(params, "id"),
    password: formField<PasskeyRemoveRequest>(params, "password"),
    code: formField<PasskeyRemoveRequest>(params, "code"),
  };
  const records = authed.user.passkeys ?? [];
  const target = resolveRemoveTarget(records, input);
  if (target.kind === "not-found") {
    sendPasskeyError(res, 404, "not_found");
    return;
  }
  if (target.kind === "ambiguous") {
    sendPasskeyError(res, 400, "bad_request", "ambiguous-id");
    return;
  }
  const credentialIds = target.kind === "all" ? [] : target.credentialIds;
  const remaining = input.all ? 0 : records.length - 1;
  if (input.all || remaining === 0) {
    const reauthOk = await reauthenticate(deps, authed.username, authed.user, {
      password: input.password,
      code: input.code,
    });
    if (!reauthOk) {
      deps.limiter.recordFailure(ip, authed.username);
      deps.logger.warn("passkey remove rejected: re-authentication failed");
      sendPasskeyError(res, 401, "unauthorized");
      return;
    }
  }
  const removed = await removePasskeys(deps, authed.username, input.all, credentialIds);
  if (removed === undefined) {
    sendPasskeyStoreUnavailable(res);
    return;
  }
  sendPasskeyJson(res, 200, { ok: true, removed });
  deps.logger.info(
    `passkey removed: ${authed.username} (${removed} credential${removed === 1 ? "" : "s"})`,
  );
}

/** 删除目标：`all` 清空；否则按前缀唯一匹配。 */
type RemoveTarget =
  | { readonly kind: "all" }
  | { readonly kind: "one"; readonly credentialIds: readonly string[] }
  | { readonly kind: "not-found" }
  | { readonly kind: "ambiguous" };

/** 解析删除目标（`all=1` 优先于 `id`）。 */
function resolveRemoveTarget(
  records: readonly import("../../../entities/user/index.js").PasskeyRecord[],
  input: RemoveInput,
): RemoveTarget {
  if (input.all) return { kind: "all" };
  const match = matchCredentialPrefix(records, input.id);
  if (match.kind === "none") return { kind: "not-found" };
  if (match.kind === "ambiguous") return { kind: "ambiguous" };
  return { kind: "one", credentialIds: [match.record.credentialId] };
}

/**
 * 锁内删除：按 `credentialIds` 过滤（`all` 时清空）。**保留 `passkeyUserHandle`**：
 * 它是用户的稳定 WebAuthn 身份，重新注册时复用，删凭据不该改变它。
 * 返回删除条数；写盘失败返回 undefined（503）。
 */
async function removePasskeys(
  deps: PasskeyManagementDeps,
  username: string,
  all: boolean,
  credentialIds: readonly string[],
): Promise<number | undefined> {
  let removed = 0;
  try {
    await deps.management.mutateUsers((snapshot) => {
      const user = snapshot.users.get(username);
      if (user === undefined) return;
      const existing = user.passkeys ?? [];
      const keep = all
        ? []
        : existing.filter((record) => !credentialIds.includes(record.credentialId));
      removed = existing.length - keep.length;
      user.passkeys = keep;
    });
  } catch (error) {
    deps.logger.error(
      `passkey remove: write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
  return removed;
}
