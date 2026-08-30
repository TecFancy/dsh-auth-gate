import { cp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dshHomeDir } from "./users-file.js";
/**
 * 随包分发的配置速查技能安装（`dsh-auth skill install`）。
 *
 * 包内技能位于 `<包根>/.agents/skills/dsh-auth-gate-config/`（npm files 白名单随包分发），
 * 安装目标为 `$DSH_HOME/skills/dsh-auth-gate-config/`（dsh-skill-filesystem 的用户级
 * 技能根（user-dsh），部署侧 agent 自动发现，用户可直接问「auth-gate 支持哪些配置」。
 *
 * 语义：目标已存在且非 --force → 跳过（不覆盖用户对技能的本地修改）；--force 覆盖。
 */
/** 技能目录名（与包内 .agents/skills 子目录同名）。 */
export const SKILL_NAME = "dsh-auth-gate-config";
/**
 * 包内技能源目录：<包根>/.agents/skills/<SKILL_NAME>。
 * 本模块位于 <包根>/src/shared/（构建产物 <包根>/lib/shared/），`dirname` 向上两层即包根；
 * 若将来模块再移动，这里的深度假设需同步调整。
 */
export function bundledSkillDir() {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".agents", "skills", SKILL_NAME);
}
/** 用户级技能目标目录：$DSH_HOME/skills/<SKILL_NAME>。 */
export function userSkillDir() {
    return path.join(dshHomeDir(), "skills", SKILL_NAME);
}
/** 幂等安装：缺失/强制时整目录复制（fs.cp recursive），否则跳过。 */
export async function installSkill(options) {
    const sourceExists = await pathExists(options.sourceDir);
    if (!sourceExists)
        return { status: "source-missing" };
    const targetExists = await pathExists(options.targetDir);
    if (targetExists && !options.force)
        return { status: "up-to-date" };
    await cp(options.sourceDir, options.targetDir, { recursive: true, force: true });
    return { status: "installed" };
}
async function pathExists(dir) {
    try {
        await stat(dir);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=skill-install.js.map