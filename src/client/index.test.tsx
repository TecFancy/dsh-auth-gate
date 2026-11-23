import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, ACCOUNT_KEYS } from "./shared/i18n/index.ts";
import { SettingsAccountSection } from "./widgets/account-section/index.ts";
import type { AuthSlotRegisterOptions, AuthContext } from "./shared/api/index.ts";
import { apply } from "./index.tsx";
import { SettingsLogoutAction } from "./features/logout/index.ts";

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

/** 触发槽位注入并拿回它的 disposer（等价于宿主卸载该槽位）。 */
function slotDisposer(h: ReturnType<typeof makeHarness>, key: string): () => void {
  const entry = h.injectCalls.find(([slot]) => slot === key);
  if (entry === undefined) throw new Error(`missing slot injection: ${key}`);
  return entry[1]();
}

/** `/auth/status` 的最小响应形（探针会检查 res.ok 再解析 JSON）。 */
function statusResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

/** 挂起中的响应：由测试决定何时放行。 */
function deferred(): { promise: Promise<Response>; release: (response: Response) => void } {
  let release: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    release = (response) => resolve(response);
  });
  return { promise, release };
}

/** 让整条探针微任务链跑完。 */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(statusResponse({ authenticated: false, logoutOrder: 1000 }));
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

  it("registers the account section with the frozen id, order 900 and a locale thunk label", () => {
    const h = makeHarness();
    apply(h.ctx);
    mountSlot(h, "settings.section");
    expect(h.registers).toHaveLength(1);
    const { opts, component } = h.registers[0]!;
    expect(opts.name).toBe("settings.section");
    expect(opts.id).toBe("dsh-auth-gate-account");
    expect(opts.locale).toBe("auth");
    expect(opts.order).toBe(900);
    expect(component).toBe(SettingsAccountSection);
    expect(typeof opts.label).toBe("function");
    // order 选址：大于全部已知条目（宿主 0/10/15/20、姊妹包订阅页 90），落在导航靠后。
    expect(opts.order).toBeGreaterThan(90);
    expect(opts.order).toBeLessThan(1000);
  });

  it("never takes the host's reserved `account` section id (0.1.7 官方云账户页占用它)", () => {
    const h = makeHarness();
    apply(h.ctx);
    mountSlot(h, "settings.section");
    // 同 id 会被 `only` 过滤同时挂载（双段内容），且语义错位：官方那段是 DeepSeek 云账户。
    expect(h.registers[0]!.opts.id).not.toBe("account");
  });

  it("re-projects the section label from the active locale on the same thunk", () => {
    const h = makeHarness();
    apply(h.ctx);
    mountSlot(h, "settings.section");
    const label = h.registers[0]!.opts.label as () => string;
    expect(label()).toBe("账号安全");
    h.switchLocale({ logout: "Sign out", ...ACCOUNT_DICT_EN });
    expect(label()).toBe("Account security");
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
      // 品牌串不是文案：包名 + 版本号在两种语言下一个字都不该变（`dsh-auth-gate v0.24.0`）。
      // 显式例外，而不是把这条守卫整体放松 - 其余键仍必须真的翻译过。
      if (key === ACCOUNT_KEYS.footerVersion) continue;
      expect(enDict[key]).not.toBe(zhDict[key]);
    }
  });
});

describe("logout-order probe (C2)", () => {
  it("keeps the default order and aborts the probe when the item is disposed early (C2)", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const h = makeHarness();
    apply(h.ctx);
    const dispose = slotDisposer(h, "settings.general.item");
    expect(h.registers).toHaveLength(1);
    const signal = (fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)?.signal;
    expect(signal?.aborted).toBe(false);

    dispose();
    expect(signal?.aborted).toBe(true); // 卸载即 abort：迟到响应不再占一个没人释放的注册
    pending.release(statusResponse({ authenticated: true, logoutOrder: 5000 }));
    await flushMicrotasks();
    expect(h.registers).toHaveLength(1);
  });

  it("keeps the default order when the probe response is not ok (C2)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ authenticated: true, logoutOrder: 5000 }),
    });
    const h = makeHarness();
    apply(h.ctx);
    mountSlot(h, "settings.general.item");
    await flushMicrotasks();
    expect(h.registers).toHaveLength(1);
    expect(h.registers[0]!.opts.order ?? 0).toBe(1000);
  });

  it("ignores an order that is not an integer after whitelist parsing", async () => {
    fetchMock.mockResolvedValue(statusResponse({ authenticated: true, logoutOrder: 1000.5 }));
    const h = makeHarness();
    apply(h.ctx);
    mountSlot(h, "settings.general.item");
    await flushMicrotasks();
    expect(h.registers).toHaveLength(1);
  });
});
