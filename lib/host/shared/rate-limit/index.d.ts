/**
 * shared/rate-limit segment public API: the login attempt limiter.
 * Explicit export list: register new exports here.
 */
export { LoginRateLimiter } from "./rate-limit.js";
export type { Admission, AdmissionResult, RateLimitCheck, RateLimitOptions, RateLimitScope, } from "./rate-limit.js";
