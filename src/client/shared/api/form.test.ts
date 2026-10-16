import { describe, expect, it } from "vitest";
import { encodeForm } from "./form.ts";

describe("encodeForm", () => {
  it("encodes every present field in literal order, values untouched", () => {
    expect(encodeForm({ target: "alice", password: " p&ss=1 ", code: "" }).toString()).toBe(
      "target=alice&password=+p%26ss%3D1+&code=",
    );
  });

  it("omits optional fields that are undefined", () => {
    const fields: { target: string; code?: string | undefined } = {
      target: "bob",
      code: undefined,
    };
    expect(encodeForm(fields).toString()).toBe("target=bob");
  });
});
