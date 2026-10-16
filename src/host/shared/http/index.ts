/**
 * shared/http segment public API: request-level helpers that every HTTP surface reuses.
 * Cookie and form parsing, Origin and Host checks, client IP resolution, `next` validation,
 * the post-login redirect, and the session-independent endpoint pieces (`authCatchAll`,
 * `queryOf`, `methodNotAllowed`).
 * Explicit export list: a new export must be registered here so the public surface cannot
 * grow by accident.
 */
export { isSafeRelativeTarget, validateNext } from "./auth-common.js";
export {
  DEFAULT_TRUSTED_PROXIES,
  makeClientIpResolver,
  parseClientIpPolicy,
  resolveClientIp,
} from "./client-ip.js";
export type { ClientIpLogger, ClientIpPolicy, ClientIpResolver } from "./client-ip.js";
export { parseCookieHeader } from "./cookie.js";
export { authCatchAll, methodNotAllowed, queryOf } from "./endpoints.js";
export { FORM_BODY_LIMIT, formField, parseFormBody } from "./form-body.js";
export { resolvePublicHost } from "./host.js";
export { cidrContains, normalizeIp, parseCidr } from "./ip-address.js";
export type { CidrNetwork } from "./ip-address.js";
export { resolvePostLoginLocation } from "./login-redirect.js";
export type { LaunchTokenBridge } from "./login-redirect.js";
export { checkRequestOrigin } from "./origin.js";
export type { OriginCheckRequest, OriginFailure, OriginVerdict } from "./origin.js";
