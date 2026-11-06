/**
 * 配置 schema：匿名统计的两个键。
 *
 * 钉住的是 schema 节点本身的元数据（`.volatile()` / `.hidden(true)` 与默认值），而不只是类型：
 * `installId` 必须是隐藏的 volatile 盒子（设置服务要靠它写回），`telemetry` 必须是**可见**的
 * 布尔项、默认开启（默认开但用户能看见、能关）。
 */
import { describe, expect, it } from "vitest";
import { Config } from "./index.js";

describe("匿名统计配置项", () => {
  it("defaults to telemetry on with an empty hidden install id", () => {
    const parsed = Config({});
    expect(parsed.telemetry).toBe(true);
    expect(parsed.installId.get()).toBe("");
    expect(Config.dict?.["telemetry"]?.meta.hidden).not.toBe(true);
    expect(Config.dict?.["installId"]?.meta).toMatchObject({ hidden: true, volatile: true });
  });
});
