import { describe, expect, it } from "vitest";
import {
  buildChallengeValue,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  parseChallengeValue,
} from "./challenge-cookie.js";

const KEY = Buffer.alloc(32, 7);
const NOW = 1_700_000_000_000;
const FUTURE = NOW + CHALLENGE_TTL_SECONDS * 1000;

describe("challenge cookie (D10: HMAC-signed)", () => {
  it("valid signed cookie parses back to the username", () => {
    const value = buildChallengeValue("alice", FUTURE, KEY);
    expect(parseChallengeValue(value, NOW, KEY)).toBe("alice");
  });

  it("dotted username round-trips (last-dot split, P5 allows dots)", () => {
    const value = buildChallengeValue("alice.bob", FUTURE, KEY);
    expect(parseChallengeValue(value, NOW, KEY)).toBe("alice.bob");
  });

  it("tampered mac is treated as no challenge", () => {
    const value = buildChallengeValue("alice", FUTURE, KEY);
    const tampered = `${value.slice(0, -1)}A`;
    expect(parseChallengeValue(tampered, NOW, KEY)).toBeUndefined();
  });

  it("forged unsigned old-format value (alice.<exp>) is treated as no challenge", () => {
    const legacy = `alice.${FUTURE}`;
    expect(parseChallengeValue(legacy, NOW, KEY)).toBeUndefined();
  });

  it("wrong key (simulating restart) rejects a cookie issued by another key", () => {
    const value = buildChallengeValue("alice", FUTURE, Buffer.alloc(32, 9));
    expect(parseChallengeValue(value, NOW, KEY)).toBeUndefined();
  });

  it("expired signed cookie is treated as no challenge", () => {
    const value = buildChallengeValue("alice", NOW - 1, KEY);
    expect(parseChallengeValue(value, NOW, KEY)).toBeUndefined();
  });

  it("absurd future timestamp beyond TTL is rejected", () => {
    const value = buildChallengeValue("alice", NOW + CHALLENGE_TTL_SECONDS * 1000 * 2, KEY);
    expect(parseChallengeValue(value, NOW, KEY)).toBeUndefined();
  });

  it("malformed values are rejected", () => {
    expect(parseChallengeValue(undefined, NOW, KEY)).toBeUndefined();
    expect(parseChallengeValue("", NOW, KEY)).toBeUndefined();
    expect(parseChallengeValue("alice", NOW, KEY)).toBeUndefined(); // 无点号
    expect(parseChallengeValue(`${CHALLENGE_COOKIE}=x`, NOW, KEY)).toBeUndefined();
  });
});
