import { describe, expect, it } from "vitest";
import { safeEqual } from "./safe-equal.js";

describe("safeEqual", () => {
  it("accepts equal strings and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("rejects different lengths without throwing", () => {
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("short", "a much longer value")).toBe(false);
  });

  it("compares the full string, not a prefix", () => {
    expect(safeEqual("token", "token-and-more")).toBe(false);
    expect(safeEqual("token-and-more", "token")).toBe(false);
  });
});
