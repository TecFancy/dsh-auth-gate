import { readFileSync } from "node:fs";
import { join } from "node:path";

import { satisfies, validRange } from "semver";
import { describe, expect, it } from "vitest";

/**
 * 宿主走廊声明（D12 + D26）。
 *
 * 锁三件事，缺一不可：
 * 1. `engines.dsh` 与 storage-domain peer **逐字相同**（市场徽章去重，且两处不可能漂移）；
 * 2. 走廊字符串是**预期的那一条**（防止"两处一起改错"这类同步漂移）；
 * 3. 用宿主闸门同款判定（`semver.satisfies(..., { includePrerelease: true })`）验证
 *    它确实覆盖我们要支持的两条线，并且不误覆盖不该覆盖的线。
 *
 * 为什么值得锁：dsh 0.2.0 起的兼容闸门只读 `peerDependencies` 里的 `@deepseek-ai/dsh*`，
 * `engines.dsh` **不参与**判定；只改一处或改错一处，失败形态都是静默的
 * （bundle 被跳过 = 登录门 fail-open），不会在测试或启动时报错。
 */
const DECLARED_CORRIDOR = "^0.1.0-rc.6 || ^0.1.5-rc.2 || ^0.1.7-alpha.1 || ^0.2.0-rc.1";

/** dsh 闸门判定参数（`dsh-app-boot` 的 `evaluatePluginCompatibility`）。 */
const GATE_OPTIONS = { includePrerelease: true } as const;

const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  engines: { dsh: string };
  peerDependencies: Record<string, string>;
};

const declared = manifest.engines.dsh;
const storageDomainPeer = manifest.peerDependencies["@deepseek-ai/dsh-storage-domain"];

describe("host corridor declaration", () => {
  it("declares the identical corridor in engines.dsh and in the storage-domain peer", () => {
    expect(declared).toBe(storageDomainPeer);
  });

  it("declares exactly the expected corridor string", () => {
    expect(declared).toBe(DECLARED_CORRIDOR);
    expect(validRange(declared)).not.toBeNull();
  });

  it("covers every host line this plugin claims to support", () => {
    for (const runtime of ["0.1.5-rc.2", "0.1.7-alpha.1", "0.1.7-rc.2", "0.2.0-rc.2"]) {
      expect(satisfies(runtime, declared, GATE_OPTIONS), runtime).toBe(true);
    }
  });

  it("keeps covering the 0.2.x line ahead of the running candidate", () => {
    for (const runtime of ["0.2.0", "0.2.1"]) {
      expect(satisfies(runtime, declared, GATE_OPTIONS), runtime).toBe(true);
    }
  });

  it("does not claim hosts outside the declared corridor", () => {
    for (const runtime of ["0.1.0-rc.5", "0.3.0", "0.3.0-rc.1"]) {
      expect(satisfies(runtime, declared, GATE_OPTIONS), runtime).toBe(false);
    }
  });

  it("keeps exactly one @deepseek-ai/dsh* peer for the gate to evaluate", () => {
    const dshPeers = Object.keys(manifest.peerDependencies).filter(
      (name) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-"),
    );
    expect(dshPeers).toEqual(["@deepseek-ai/dsh-storage-domain"]);
    expect(manifest.peerDependencies["@deepseek-ai/dsh-storage-domain"]).toBe(declared);
  });
});
