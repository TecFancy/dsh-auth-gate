/**
 * P1.1 / D24 的两条"跨半边"钉子（source pin）。
 *
 * 客户端半边不能 import 服务端（切片门禁：client/ 与 host 半边双向隔离；host 侧 tsconfig 也没有
 * DOM lib），服务端测试也不能 import 客户端代码。但两边都在同一仓库里，所以按**源码文本**对齐：
 * 任何一侧改了字面量或图标路径而忘了另一侧，这两条就会红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASSWORD_CHANGED_NOTICE } from "./features/password/index.js";

/** 读仓库内的文件（相对本测试文件）。 */
function readSource(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("integration: P1.1 cross-half pins", () => {
  it("pins the client redirect literal to the server notice key", () => {
    const clientSource = readSource("./client/account-redirect.ts");
    expect(clientSource).toContain(`notice=${PASSWORD_CHANGED_NOTICE}`);
    expect(clientSource).toContain("next=%2F");
    expect(clientSource).toContain('LOGIN_REDIRECT_URL = "/auth/login?');
  });

  it("keeps the inline icon paths identical to docs/demo/account-security.svg", () => {
    const iconSource = readSource("./client/account-icon.ts");
    const svg = readSource("../docs/demo/account-security.svg");
    const paths = [...svg.matchAll(/d="([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(paths).toHaveLength(2);
    for (const d of paths) expect(iconSource).toContain(d);
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(iconSource).toContain('ACCOUNT_ICON_VIEW_BOX = "0 0 16 16"');
  });
});
