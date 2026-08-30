// lib/ 产物随 git 提交并保持新鲜（见 .github/workflows/sync-upstream.yml 的
// "Rebuild lib artifacts" 步骤，上游同步后自动重建）。
// 因此 git 依赖安装（pnpm/npm 会跑 prepack）时若 lib/ 已存在则跳过构建，
// 避免在包管理器的沙箱环境中编译失败（依赖解析差异）。
import { existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const marker = "lib/login-page.js";
const fresh = existsSync(marker) && statSync(marker).size > 0;

if (fresh) {
  console.log("[prepack] lib/ artifacts present (tracked in git), skip build");
  process.exit(0);
}

console.log("[prepack] lib/ missing, running build");
execSync("npm run build", { stdio: "inherit" });
