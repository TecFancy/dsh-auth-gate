/**
 * P1.1 / D24 的两条"跨半边"钉子（source pin）。
 *
 * 客户端半边不能 import 服务端（切片门禁：client/ 与 host 半边双向隔离；host 侧 tsconfig 也没有
 * DOM lib），服务端测试也不能 import 客户端代码。路径与原因键已收进两侧共用的 `src/protocol/`
 * （D31），这里只钉住客户端确实用的是契约常量；图标路径没有契约文件，仍按**源码文本**对齐。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASSWORD_CHANGED_NOTICE } from "../../src/host/features/password/index.js";
import { PASSWORD_CHANGED_LOGIN_URL } from "../../src/protocol/index.js";

/** 读仓库内的文件（相对本测试文件）。 */
function readSource(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("integration: P1.1 cross-half pins", () => {
  it("builds the client redirect from the shared protocol", () => {
    const clientSource = readSource(
      "../../src/client/features/change-password/lib/account-redirect.ts",
    );
    expect(clientSource).toContain("LOGIN_REDIRECT_URL = PASSWORD_CHANGED_LOGIN_URL");
    expect(clientSource).not.toContain('"/auth/');
    expect(PASSWORD_CHANGED_LOGIN_URL).toContain(`notice=${PASSWORD_CHANGED_NOTICE}`);
  });

  it("keeps the inline icon paths identical to docs/demo/account-security.svg", () => {
    const iconSource = readSource("../../src/client/shared/ui/account-icon.ts");
    const svg = readSource("../../docs/demo/account-security.svg");
    const paths = [...svg.matchAll(/d="([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(paths).toHaveLength(2);
    for (const d of paths) expect(iconSource).toContain(d);
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(iconSource).toContain('ACCOUNT_ICON_VIEW_BOX = "0 0 16 16"');
  });
});
