import { describe, expect, it } from "vitest";
import { lockoutMessage } from "./login-page-copy.js";

describe("lockout copy (D20, shared by the password, TOTP and token stages)", () => {
  it("scopes the lockout to the network and never blames an account", () => {
    const text = lockoutMessage(30);
    expect(text).toContain("Too many sign-in attempts from this network.");
    expect(text).toContain("Try again in 30 seconds.");
    expect(text).not.toMatch(/your account|locked out|remaining attempts/i);
  });

  it("uses the singular unit for one second", () => {
    expect(lockoutMessage(1)).toContain("Try again in 1 second.");
    expect(lockoutMessage(1)).not.toContain("1 seconds");
  });

  it("renders the retry-after integer without touching request text", () => {
    expect(lockoutMessage(900)).toContain("Try again in 900 seconds.");
  });
});
