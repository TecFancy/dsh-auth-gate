/**
 * 随包分发的配置速查技能安装（`dsh-auth skill install`）。
 *
 * 包内技能位于 `<包根>/.agents/skills/dsh-auth-gate-config/`（npm files 白名单随包分发），
 * 安装目标为 `$DSH_HOME/skills/dsh-auth-gate-config/` —— dsh-skill-filesystem 的用户级
 * 技能根（user-dsh），部署侧 agent 自动发现，用户可直接问「auth-gate 支持哪些配置」。
 *
 * 语义：目标已存在且非 --force → 跳过（不覆盖用户对技能的本地修改）；--force 覆盖。
 */
/** 技能目录名（与包内 .agents/skills 子目录同名）。 */
export declare const SKILL_NAME = "dsh-auth-gate-config";
/** 包内技能源目录：lib/*.js → 包根/.agents/skills/<SKILL_NAME>。 */
export declare function bundledSkillDir(): string;
/** 用户级技能目标目录：$DSH_HOME/skills/<SKILL_NAME>。 */
export declare function userSkillDir(): string;
export interface InstallSkillResult {
    /** installed = 本次复制；up-to-date = 已存在且跳过；source-missing = 包内无技能。 */
    status: "installed" | "up-to-date" | "source-missing";
}
export interface InstallSkillOptions {
    /** 源目录（测试注入；默认 bundledSkillDir()）。 */
    sourceDir: string;
    /** 目标目录（测试注入；默认 userSkillDir()）。 */
    targetDir: string;
    /** 目标已存在时是否覆盖（CLI 的 --force）。 */
    force: boolean;
}
/** 幂等安装：缺失/强制时整目录复制（fs.cp recursive），否则跳过。 */
export declare function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult>;
//# sourceMappingURL=skill-install.d.ts.map