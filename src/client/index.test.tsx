import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, ACCOUNT_KEYS } from "./account-copy.ts";
import { SettingsAccountSection } from "./account-section.tsx";
import type { AuthSlotRegisterOptions, AuthContext } from "./context.ts";
import { apply } from "./index.tsx";
import { SettingsLogoutAction } from "./logout-action.tsx";

interface RegisterCall {
  opts: AuthSlotRegisterOptions;
  component: unknown;
}

/** mock 的 slots + locale + effect；locale.bind 读可切换的活动词典（模拟语言切换）。 */
function makeHarness() {
  const registers: RegisterCall[] = [];
  const localeRegisters: [string, string, Record<string, string>][] = [];
  const injectCalls: [string, () => () => void][] = [];
  let activeDict: Record<string, string> = { logout: "退出登录", ...ACCOUNT_DICT_ZH };
  const slots = {
    register: vi.fn((opts: AuthSlotRegisterOptions, component: unknown): (() => void) => {
      registers.push({ opts, component });
      return () => undefined;
    }),
    inject: vi.fn((key: string, callback: () => () => void): (() => void) => {
      injectCalls.push([key, callback]);
      return () => undefined;
    }),
  };
  const locale = {
    register: vi.fn((ns: string, loc: string, dict: Record<string, string>): (() => void) => {
      localeRegisters.push([ns, loc, dict]);
      return () => undefined;
    }),
    bind: vi.fn(() => (key: string) => activeDict[key] ?? key),
  };
  const ctx = {
    slots,
    locale,
    effect: vi.fn((setup: () => (() => void) | Iterable<() => void>) => {
      setup();
    }),
  } as unknown as AuthContext;
  return {
    ctx,
    registers,
    localeRegisters,
    injectCalls,
    switchLocale: (dict: Record<string, string>): void => {
      activeDict = dict;
    },
  };
}

/** 触发某个槽位的注入回调（等价于宿主声明该槽位时运行 registrant）。 */
function mountSlot(h: ReturnType<typeof makeHarness>, key: string): void {
  for (const [slot, callback] of h.injectCalls) if (slot === key) callback();
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    json: () => Promise.resolve({ authenticated: false, logoutOrder: 1000 }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("apply registration", () => {
  it("contributes exactly the logout item slot and the account section slot", () => {
    const h = makeHarness();
    apply(h.ctx);
    expect(h.injectCalls.map(([key]) => key)).toEqual([
      "settings.general.item",
      "settings.section",
    ]);
  });

  it("registers the account section with the frozen id, order 500 and a locale thunk label", () => {
    const h = makeHarness();
    apply(h.ctx);
    mountSlot(h, "settings.section");
    expect(h.registers).toHaveLength(1);
    const { opts, component } = h.registers[0]!;
    expect(opts.name).toBe("settings.section");
    expect(opts.id).toBe("dsh-auth-gate-account");
    expect(opts.locale).toBe("auth");
    expect(opts.order).toBe(500);
    expect(component).toBe(SettingsAccountSection);
    expect(typeof opts.label).toBe("function");
    // order 选址：高于姊妹包订阅页 90，低于本插件登出 CTA 的 1000（注释见 index.tsx）。
    expect(opts.order).toBeGreaterThan(90);
    expect(opts.order).toBeLessThan(1000);
  });

  it("re-projects the section label from the active locale on the same thunk", () => {
    const h = makeHarness();
    apply(h.ctx);
    mountSlot(h, "settings.section");
    const label = h.registers[0]!.opts.label as () => string;
    expect(label()).toBe("账户");
    h.switchLocale({ logout: "Sign out", ...ACCOUNT_DICT_EN });
    expect(label()).toBe("Account");
  });

  it("keeps the logout CTA registration semantics unchanged (id, order 1000, zh label)", () => {
    const h = makeHarness();
    apply(h.ctx);
    mountSlot(h, "settings.general.item");
    expect(h.registers).toHaveLength(1);
    const { opts, component } = h.registers[0]!;
    expect(opts.name).toBe("settings.general.item");
    expect(opts.id).toBe("dsh-auth-gate-logout");
    expect(opts.locale).toBe("auth");
    expect(opts.order).toBe(1000);
    expect(component).toBe(SettingsLogoutAction);
    expect((opts.label as () => string)()).toBe("退出登录");
  });

  it("ships complete zh/en dictionaries in the auth namespace (logout key included)", () => {
    const h = makeHarness();
    apply(h.ctx);
    const byLocale = new Map(h.localeRegisters.map(([, loc, dict]) => [loc, dict]));
    const zhDict = byLocale.get("zh")!;
    const enDict = byLocale.get("en")!;
    expect(h.localeRegisters.every(([ns]) => ns === "auth")).toBe(true);
    expect(zhDict["logout"]).toBe("退出登录");
    expect(enDict["logout"]).toBe("Sign out");
    expect(Object.keys(zhDict).sort((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(enDict).sort((a, b) => a.localeCompare(b)),
    );
    for (const key of Object.values(ACCOUNT_KEYS)) {
      expect(zhDict[key]?.length).toBeGreaterThan(0);
      expect(enDict[key]?.length).toBeGreaterThan(0);
      expect(enDict[key]).not.toBe(zhDict[key]);
    }
  });
});
