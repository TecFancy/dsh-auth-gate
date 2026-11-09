/**
 * 匿名上报的测试支撑（**只被测试 import，产品代码不引用**）。
 *
 * 从 `telemetry.test.ts` 抽出来是因为 `src/` 下的测试文件有 250 有效行上限，而假网络、假时钟、
 * 假 settings 与断言辅助要被多个文件共用（上报模块自己的单测、`apply` 的接线测试）。
 */
import {
  makeTelemetry,
  type SettingsService,
  type Telemetry,
  type TelemetryFetch,
  type TelemetryOptions,
  type TelemetryPayload,
} from "../src/host/shared/telemetry/index.js";

/** 契约命名的 id 形状；用来代表「配置里已经存过的 id」。 */
export const STORED_ID = "0f4a9c1e-6d2b-4c33-9a51-1d2c3b4a5e6f";

/** 显式比较器（eslint 要求；默认字典序对非 ASCII 不可靠）。 */
export function sortedKeys(value: object): string[] {
  const keys = Object.keys(value);
  keys.sort((a, b) => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });
  return keys;
}

/** `RequestInit.body` 也可能是二进制；测试里只发 JSON 字符串。 */
export function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body;
  return typeof body === "string" ? body : "";
}

/** 让 fire-and-forget 的上报链上排队的微任务全部跑完，再断言它的副作用。 */
export async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/** 一个假上报器上的全部观察点。 */
export interface TelemetryReport {
  telemetry: Telemetry;
  requests: { url: string; init: RequestInit }[];
  sent: TelemetryPayload[];
  saved: string[];
  storedId: () => string;
  advance: (ms: number) => void;
}

/** 一个上报器：假网络、假时钟、假 settings，并记录它发出的每个请求与每次写回。 */
export function harness(
  overrides: Partial<TelemetryOptions> = {},
  network?: TelemetryFetch,
): TelemetryReport {
  const requests: { url: string; init: RequestInit }[] = [];
  const sent: TelemetryPayload[] = [];
  const saved: string[] = [];
  let stored = "";
  let now = 1_000_000;
  const settings: SettingsService = {
    update: (_namespace, patch) => {
      const id = (patch as { installId?: unknown }).installId;
      if (typeof id === "string") {
        saved.push(id);
        stored = id;
      }
      return Promise.resolve();
    },
  };
  const telemetry = makeTelemetry({
    enabled: true,
    mode: "password",
    totp: "off",
    installId: () => stored,
    settings: () => settings,
    users: () => 1,
    now: () => now,
    fetch: (url, init) => {
      requests.push({ url, init });
      if (network !== undefined) return network(url, init);
      sent.push(JSON.parse(bodyOf(init)) as TelemetryPayload);
      return Promise.resolve();
    },
    ...overrides,
  });
  return {
    telemetry,
    requests,
    sent,
    saved,
    storedId: () => stored,
    advance: (ms) => {
      now += ms;
    },
  };
}
