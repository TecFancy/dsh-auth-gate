/**
 * `dsh-auth` 的 usage 文本。独立文件是为了让 `src/cli.ts` 守住 250 行上限（它只超两行，
 * 而 usage 是唯一可以整块搬走、且搬走不改变任何行为的部分）。
 *
 * 新增子命令时同时改这里和 `src/cli.ts` 的分发表；`cli.test.ts` 钉住 usage 的出口行为。
 */
export const USAGE = `Usage:
  dsh-auth user add <name> --password-stdin [--admin] [--disabled] [--file <path>]
  dsh-auth user passwd <name> [--password-stdin] [--file <path>]
  dsh-auth user role <name> <admin|user> [--file <path>]
  dsh-auth user list [--file <path>]
  dsh-auth user disable <name> [--file <path>]
  dsh-auth user enable <name> [--file <path>]
  dsh-auth user totp <enable|disable> <name> [--file <path>]
  dsh-auth passkey list <name> [--file <path>]
  dsh-auth passkey rm <name> (--id <prefix> | --all) [--force] [--file <path>]
  dsh-auth skill install [--force]`;
