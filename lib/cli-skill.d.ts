/** `dsh-auth skill install [--force]` 需要的注入面（结构兼容 `CliCtx`）。 */
interface SkillCommandCtx {
    readonly argv: string[];
    readonly io: {
        out(line: string): void;
        err(line: string): void;
    };
}
/**
 * `dsh-auth skill install [--force]`：把包内配置速查技能装到 `$DSH_HOME/skills/`。
 * 从 `src/cli.ts` 拆出（守住 250 行文件上限）：它只依赖 argv/io，与口令/角色命令无关。
 */
export declare function installSkillCommand(ctx: SkillCommandCtx): Promise<number>;
export {};
//# sourceMappingURL=cli-skill.d.ts.map