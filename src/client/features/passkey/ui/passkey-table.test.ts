// @vitest-environment jsdom
/**
 * `formatPasskeyDate` 的时区行为（F4 回归）。
 *
 * 原实现用 `toISOString().slice(0, 10)`，那是 UTC 日期：东八区用户在 UTC 16:00 之后
 * 创建的凭据会显示成「昨天」。这里钉住三件事：本地时区取日期、显式 timeZone 生效、
 * 跨日边界不再回退一天。
 */
import { describe, expect, it } from "vitest";
import { formatPasskeyDate } from "./passkey-table.tsx";

/** 2026-11-15T23:00:00Z：UTC 是 15 号，东八区已经是 16 号。 */
const CROSS_DAY = Date.UTC(2026, 10, 15, 23, 0, 0);

describe("formatPasskeyDate", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(formatPasskeyDate(CROSS_DAY, "UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("uses the given time zone instead of UTC", () => {
    expect(formatPasskeyDate(CROSS_DAY, "UTC")).toBe("2026-11-15");
    expect(formatPasskeyDate(CROSS_DAY, "Asia/Shanghai")).toBe("2026-11-16");
  });

  it("does not fall back to the UTC date when the local day is ahead", () => {
    // 这条是原 bug 的回归：UTC 切片会给出 2026-11-15，本地时区必须给出 16 号。
    expect(formatPasskeyDate(CROSS_DAY, "Asia/Shanghai")).not.toBe(
      new Date(CROSS_DAY).toISOString().slice(0, 10),
    );
  });

  it("keeps the same day when the zone is behind UTC", () => {
    expect(formatPasskeyDate(CROSS_DAY, "America/New_York")).toBe("2026-11-15");
  });

  it("defaults to the runtime time zone when none is given", () => {
    const local = new Date(CROSS_DAY);
    const expected = [
      String(local.getFullYear()),
      String(local.getMonth() + 1).padStart(2, "0"),
      String(local.getDate()).padStart(2, "0"),
    ].join("-");
    expect(formatPasskeyDate(CROSS_DAY)).toBe(expected);
  });
});
describe("formatPasskeyDate: 线上脏数据不炸渲染 (C7)", () => {
  it("renders a placeholder for non-finite and out-of-range epoch values", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      8.64e15 + 1,
    ]) {
      expect(formatPasskeyDate(value)).toBe("-");
    }
  });
});
