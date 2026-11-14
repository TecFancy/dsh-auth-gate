import { describe, expect, it } from "vitest";
import {
  buildCeremonyCookie,
  CEREMONY_COOKIE,
  CEREMONY_TTL_SECONDS,
  clearCeremonyCookie,
  readCeremonyId,
} from "./ceremony-cookie.js";

describe("ceremony cookie", () => {
  it("exports the cookie name and TTL mirrored by the store default", () => {
    expect(CEREMONY_COOKIE).toBe("dsh_auth_pk");
    expect(CEREMONY_TTL_SECONDS).toBe(120);
  });

  it("builds the exact secure Set-Cookie value", () => {
    expect(buildCeremonyCookie("abc123", true)).toBe(
      "dsh_auth_pk=abc123; Max-Age=120; Path=/auth; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("omits Secure when secure=false", () => {
    expect(buildCeremonyCookie("abc123", false)).toBe(
      "dsh_auth_pk=abc123; Max-Age=120; Path=/auth; HttpOnly; SameSite=Lax",
    );
  });

  it("clears the cookie with Max-Age=0 and an empty value", () => {
    expect(clearCeremonyCookie(true)).toBe(
      "dsh_auth_pk=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Lax",
    );
    expect(clearCeremonyCookie(false)).toBe(
      "dsh_auth_pk=; Max-Age=0; Path=/auth; HttpOnly; SameSite=Lax",
    );
  });

  it("reads the id from a cookie header (first match, other cookies ignored)", () => {
    expect(readCeremonyId("theme=dark; dsh_auth_pk=abc123; other=1")).toBe("abc123");
    expect(readCeremonyId("dsh_auth_pk=abc123")).toBe("abc123");
  });

  it("returns undefined for a missing header, missing name, or empty value", () => {
    expect(readCeremonyId(undefined)).toBeUndefined();
    expect(readCeremonyId("")).toBeUndefined();
    expect(readCeremonyId("theme=dark")).toBeUndefined();
    expect(readCeremonyId("dsh_auth_pk=")).toBeUndefined();
    expect(readCeremonyId("dsh_auth_pk_extra=abc123")).toBeUndefined();
  });
});
