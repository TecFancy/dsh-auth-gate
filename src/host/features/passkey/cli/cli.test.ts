import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlePasskeyCli } from "./cli.js";
import {
  CRED_A,
  makeIo,
  makeTempUsersFile,
  seed,
  seedThree,
} from "../../../../../test/passkey-cli-harness.js";

let dir: string;
let file: string;

beforeEach(async () => {
  ({ dir, file } = await makeTempUsersFile());
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("dsh-auth passkey list", () => {
  it("prints one fixed-shape line per passkey and truncates the credential id", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "alice", {}, h.io)).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toEqual([
      "MacBook Touch ID · id=AAAABBBBCCCC… · created=2025-01-02T03:04:05.000Z · last-used=2025-02-03T04:05:06.000Z · be=false bs=true · transports=internal,hybrid",
      "Phone · id=AAAABBBBCCCC… · created=2025-01-02T03:04:05.000Z · last-used=never · be=true bs=false · transports=-",
      "Backup · id=111122223333… · created=2025-01-02T03:04:05.000Z · last-used=2025-02-03T04:05:06.000Z · be=false bs=true · transports=usb",
    ]);
    expect(h.out.join("\n")).not.toContain(CRED_A);
  });

  it("reports a user without passkeys without failing", async () => {
    await seed(file, "alice", []);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "alice", {}, h.io)).toBe(0);
    expect(h.out).toEqual(["no passkeys for alice"]);
  });

  it("reports an unknown user", async () => {
    await seedThree(file);
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "ghost", {}, h.io)).toBe(1);
    expect(h.err).toEqual(["user ghost not found"]);
  });

  it("reports a missing users file as an unknown user", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "alice", {}, h.io)).toBe(1);
    expect(h.err).toEqual(["user alice not found"]);
  });

  it("surfaces a users file load error", async () => {
    await fs.writeFile(file, "users: [unclosed", { mode: 0o600 });
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", "alice", {}, h.io)).toBe(1);
    expect(h.err.join("\n")).toContain("invalid users file");
  });

  it("prints usage without a user name", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "list", undefined, {}, h.io)).toBe(1);
    expect(h.err).toEqual(["Usage: dsh-auth passkey <list|rm> ..."]);
  });
});

describe("dsh-auth passkey dispatch", () => {
  it("prints usage for an unknown subcommand", async () => {
    const h = makeIo();
    expect(await handlePasskeyCli(file, "frobnicate", "alice", {}, h.io)).toBe(1);
    expect(h.err).toEqual(["Usage: dsh-auth passkey <list|rm> ..."]);
  });
});
