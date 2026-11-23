import { readFileSync } from "node:fs";

/**
 * 本包版本号，供断言 `/auth/status` 线上 `version` 的测试使用。
 *
 * 读的是与 host 同一个 `package.json`：**不钉字面量** - release-please 每发一版都会改它，
 * 钉死的期望值会让每次发版 CI 都红，而这里要守住的契约是"host 报的是自己那一版"。
 */
export const PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
