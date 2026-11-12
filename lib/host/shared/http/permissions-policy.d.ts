import type { ServerResponse } from "node:http";
/**
 * 禁止本实例被跨源 iframe 当作 WebAuthn 中继（plan §5.2）：登录页与全部 `/auth` 响应
 * 统一下发该值。只限制 PublicKeyCredential 两个能力，不影响其它功能；同源页面不受影响。
 */
export declare const PASSKEY_PERMISSIONS_POLICY = "publickey-credentials-get=(), publickey-credentials-create=()";
/** 在响应头阶段下发 `Permissions-Policy`；必须在 `writeHead` 之前调用。 */
export declare function setPasskeyPermissionsPolicy(res: ServerResponse): void;
//# sourceMappingURL=permissions-policy.d.ts.map