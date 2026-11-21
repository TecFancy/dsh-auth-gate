import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_ZH, formatCopy, type AccountTranslate } from "../../../shared/i18n/index.ts";
import { submitPassword } from "./account-submit.ts";

/**
 * `describeFailure` 的响应矩阵（契约 §1）：C1 的核心是**不把任何 401 都说成「当前口令错」**。
 *
 * 401 `unauthorized` = 会话失效 → 独立的「重新登录」视图；403 `bad_origin` = 跨源提交被拒 →
 * 自己的文案；`invalidCredentials` 只留给真正的口令错（`invalid_credentials` 或缺码）。
 */

const t: AccountTranslate = (key, params) => formatCopy(ACCOUNT_DICT_ZH[key] ?? key, params);

/** 只填到能通过本地校验的值：字段内容不影响映射。 */
const VALUES = { current: "old pass", password: "NewPassw0rd", confirm: "NewPassw0rd", code: "" };

function jsonResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: () => Promise.resolve(body) } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 用给定的状态码/错误体提交一次，返回映射出的失败视图。 */
async function failureOf(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body));
  vi.stubGlobal("fetch", fetchMock);
  const result = await submitPassword(VALUES, new AbortController().signal, t);
  expect(result.kind).toBe("failure");
  return result.kind === "failure" ? result.failure : undefined;
}

describe("submitPassword: 401 的三种含义", () => {
  it("maps unauthorized to the session-expired view with a re-login entry", async () => {
    const failure = await failureOf(401, { error: "unauthorized" });
    expect(failure?.message).toBe(t("account.expired"));
    expect(failure?.relogin).toBe(true);
    // 会话失效不是字段错误：不能标红「当前密码」。
    expect(failure?.fields).toEqual([]);
  });

  it("keeps invalidCredentials only for a real wrong password", async () => {
    const failure = await failureOf(401, { error: "invalid_credentials" });
    expect(failure?.message).toBe(t("account.invalidCredentials"));
    expect(failure?.relogin).toBeUndefined();
    expect(failure?.fields).toEqual(["current"]);
  });

  it("treats an unknown or bodyless 401 as an expired session, not a wrong password", async () => {
    for (const body of [{ error: "something_else" }, {}, { error: "unauthorized" }]) {
      const failure = await failureOf(401, body);
      expect(failure?.message).toBe(t("account.expired"));
      expect(failure?.relogin).toBe(true);
      expect(failure?.fields).toEqual([]);
    }
  });

  it("maps invalid_totp to the verification-code field, never to the password", async () => {
    const failure = await failureOf(401, { error: "invalid_totp" });
    expect(failure?.message).toBe(t("account.invalidTotp"));
    expect(failure?.fields).toEqual(["code"]);
    expect(failure?.relogin).toBeUndefined();
  });
});

describe("submitPassword: 403 与其余状态码", () => {
  it("maps bad_origin to its own message", async () => {
    const failure = await failureOf(403, { error: "bad_origin" });
    expect(failure?.message).toBe(t("account.badOrigin"));
    expect(failure?.fields).toEqual([]);
  });

  it("falls back to generic for an unknown 403 body", async () => {
    const failure = await failureOf(403, { error: "forbidden" });
    expect(failure?.message).toBe(t("account.generic"));
  });

  it("keeps the policy rules mapping", async () => {
    const failure = await failureOf(400, { error: "policy", rules: ["minLength", "digit"] });
    expect(failure?.fields).toEqual(["password"]);
    expect(failure?.rules).toEqual([t("account.rule.minLength"), t("account.rule.digit")]);
  });
});

describe("submitPassword: transport failures", () => {
  it("maps a 429 with a numeric retryAfter to the interpolated copy", async () => {
    const failure = await failureOf(429, { error: "locked", retryAfter: 30 });
    expect(failure?.message).toBe(t("account.locked", { seconds: 30 }));
  });

  it("maps a text/plain 503 to the unavailable copy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("not json")),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await submitPassword(VALUES, new AbortController().signal, t);
    expect(result).toEqual({
      kind: "failure",
      failure: { message: t("account.unavailable"), rules: [], fields: [] },
    });
  });
});
