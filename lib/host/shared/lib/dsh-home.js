import os from "node:os";
import path from "node:path";
/** P6：DSH_HOME env → `~/.dsh` 兜底。CLI 与插件共享；users 文件与技能安装各自在其上拼子路径。 */
export function dshHomeDir() {
    return process.env["DSH_HOME"] ?? path.join(os.homedir(), ".dsh");
}
//# sourceMappingURL=dsh-home.js.map