/**
 * 配置 schema：设置页能写回的那几个键。
 *
 * 钉住的是 schema 节点本身的元数据（`.volatile()` / `.hidden(true)` 与默认值），而不只是类型：
 * 宿主 `dsh-settings` 只把 volatile 字段投影成设置页表单、也只允许写回这些字段，所以漏标
 * `.volatile()` 的表现不是类型错误，而是「界面显示保存成功、重启后回到配置文件的值」。
 *
 * - `installId` 必须是隐藏的 volatile 盒子（遥测要靠它写回）。
 * - `passkeyConditionalUi` 必须是 volatile 盒子（管理员在「账号安全」里勾选条件 UI）。
 * - `telemetry` 必须是**可见**的布尔项、默认开启（默认开但用户能看见、能关）。
 */
import { describe, expect, it } from "vitest";
import { Config } from "./index.js";

describe("配置项的 volatile 元数据", () => {
  it("defaults to telemetry on with an empty hidden install id", () => {
    const parsed = Config({});
    expect(parsed.telemetry).toBe(true);
    expect(parsed.installId.get()).toBe("");
    expect(Config.dict?.["telemetry"]?.meta.hidden).not.toBe(true);
    expect(Config.dict?.["installId"]?.meta).toMatchObject({ hidden: true, volatile: true });
  });

  it("exposes the conditional-UI switch as a writable volatile box, off by default", () => {
    const parsed = Config({});
    expect(parsed.passkeyConditionalUi.get()).toBe(false);
    // 设置页要写回它，所以必须 volatile；它不是隐藏项（管理员要能看见并勾选）。
    expect(Config.dict?.["passkeyConditionalUi"]?.meta).toMatchObject({ volatile: true });
    expect(Config.dict?.["passkeyConditionalUi"]?.meta.hidden).not.toBe(true);
  });

  it("keeps the deployment-level passkey switch out of the settings page", () => {
    // `passkey` 是部署级开关（要 publicHost 与 HTTPS 才成立），故意**不** volatile：
    // 设置页不该出现它，否则管理员能在不满足前提的实例上把它打开。
    // 先断言字段存在，否则「删掉整个字段」也会让下面那条判断通过。
    const node = Config.dict?.["passkey"];
    expect(node).toBeDefined();
    expect(node?.meta.volatile).toBeUndefined();
  });
});
