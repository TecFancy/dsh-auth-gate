/**
 * shared/login-page segment public API: the server-rendered login, password, TOTP challenge
 * and passkey-only pages, plus the card stylesheet the first-run wizard reuses so every
 * server-rendered page of this plugin looks the same. Explicit export list: register new
 * exports here.
 */
export { loginPageHtml, passwordLoginPageHtml, totpChallengePageHtml } from "./login-page.js";
export { PASSKEY_ONLY_ERROR_TEXT, PASSKEY_ONLY_HINT, PASSKEY_ONLY_NOSCRIPT, PASSKEY_ONLY_UNSUPPORTED, passkeyOnlyLoginPageHtml, passkeyOnlyUnavailablePageHtml, } from "./passkey-only-login-page.js";
export { CARD_STYLE } from "./login-page-assets.js";
