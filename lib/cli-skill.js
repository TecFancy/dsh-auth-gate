import { bundledSkillDir, installSkill, SKILL_NAME, userSkillDir } from "./shared/index.js";
/**
 * `dsh-auth skill install [--force]`：把包内配置速查技能装到 `$DSH_HOME/skills/`。
 * 从 `src/cli.ts` 拆出（守住 250 行文件上限）：它只依赖 argv/io，与口令/角色命令无关。
 */
export async function installSkillCommand(ctx) {
    const target = userSkillDir();
    const force = ctx.argv.includes("--force");
    const result = await installSkill({ sourceDir: bundledSkillDir(), targetDir: target, force });
    if (result.status === "source-missing") {
        ctx.io.err("bundled skill not found (package layout changed?)");
        return 1;
    }
    const current = result.status === "up-to-date";
    const note = current ? " (use --force to update)" : "";
    const verb = current ? "already installed at" : "installed to";
    ctx.io.out(`skill ${SKILL_NAME} ${verb} ${target}${note}`);
    return 0;
}
//# sourceMappingURL=cli-skill.js.map