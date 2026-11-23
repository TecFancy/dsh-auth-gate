// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_DICT_EN,
  ACCOUNT_DICT_ZH,
  ACCOUNT_KEYS,
  formatCopy,
} from "../../../shared/i18n/index.ts";
import { AccountSectionFooter } from "./section-footer.tsx";

// React 18 的 act() 需要显式声明测试环境（否则只警告不生效）。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 与 host locale 同形的 translate（支持 {version} 插值）。 */
function makeT(dict: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string =>
    formatCopy(dict[key] ?? key, params);
}

const zh = makeT(ACCOUNT_DICT_ZH);
const en = makeT(ACCOUNT_DICT_EN);

const REPO_URL = "https://github.com/TecFancy/dsh-auth-gate";
const VERSION = "0.24.0";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: { t: typeof zh; version?: string | undefined; showStar: boolean }): void {
  act(() => root.render(createElement(AccountSectionFooter, props)));
}

describe("AccountSectionFooter: version line", () => {
  it("renders the host-reported version verbatim", () => {
    render({ t: zh, version: VERSION, showStar: false });
    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
    // 插值必须落在字面量位置：`v{version}` 不能被当成两个词条或吞掉版本号。
    expect(footer?.textContent).toBe(zh(ACCOUNT_KEYS.footerVersion, { version: VERSION }));
    expect(footer?.textContent).toContain(`v${VERSION}`);
  });

  it("does not render a version line when the host reports none", () => {
    render({ t: zh, version: undefined, showStar: false });
    expect(container.firstChild).toBeNull();
  });

  it("treats an empty version string as unknown", () => {
    // host 读不到 package.json 时写空串；空串不得渲染成一个孤零零的 `v`。
    render({ t: zh, version: "", showStar: true });
    expect(container.textContent).not.toContain("dsh-auth-gate v");
    expect(container.querySelector("a")?.textContent).toBe(zh(ACCOUNT_KEYS.starCta));
  });

  it("follows the active locale for the label, not the version number", () => {
    render({ t: en, version: VERSION, showStar: false });
    expect(container.textContent).toContain(`v${VERSION}`);
    expect(container.textContent).toContain("dsh-auth-gate v0.24.0");
  });
});

describe("AccountSectionFooter: star entry", () => {
  it("renders a single external link to the repository when asked to", () => {
    render({ t: zh, version: VERSION, showStar: true });
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link?.getAttribute("href")).toBe(REPO_URL);
    // 新标签页打开且不带回 referrer/opener：设置页是已认证界面，外链不继承窗口句柄。
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toBe(zh(ACCOUNT_KEYS.starCta));
    expect(link?.getAttribute("title")).toBe(zh(ACCOUNT_KEYS.starHint));
  });

  it("keeps the star entry out of the footer when the audience gate fails", () => {
    render({ t: zh, version: VERSION, showStar: false });
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
  });

  it("renders the star entry alone when the version is unknown", () => {
    render({ t: en, version: undefined, showStar: true });
    expect(container.querySelector("footer")).not.toBeNull();
    expect(container.querySelectorAll("span")).toHaveLength(0);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(REPO_URL);
  });
});
