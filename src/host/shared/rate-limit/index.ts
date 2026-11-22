/**
 * shared/rate-limit segment public API: the login attempt limiter.
 * Explicit export list: register new exports here.
 */
export { LoginRateLimiter } from "./rate-limit.js";
export { combineAdmissions } from "./types.js";
export type {
  Admission,
  AdmissionResult,
  RateLimitCheck,
  RateLimitOptions,
  RateLimitScope,
} from "./types.js";
