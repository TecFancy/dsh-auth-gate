import { generateTotpSecret } from "./totp.js";
import {
  mutateUsersFile,
  USERNAME_RE,
  UsersFileError,
  type UsersSnapshot,
} from "../../shared/index.js";

/** otpauth URI 的 issuer（M4 T3）。 */
const TOTP_ISSUER = "dsh-auth";

export interface TotpCliIo {
  out(line: string): void;
  err(line: string): void;
}

/**
 * `dsh-auth user totp <enable|disable> <name>`（M4 T14）。
 * enable：生成新 secret（已存在则拒绝），锁内写回 users.yaml，输出 base32 + otpauth URI。
 * disable：移除 secret（幂等）。两条路径都 spread 既有 record，role/mustChangePassword
 * 不会被抹掉（P1 评审 A1：旧实现手工重建 record，新 schema 下会丢字段）。
 */
export async function handleUserTotp(
  file: string,
  command: string | undefined,
  name: string | undefined,
  io: TotpCliIo,
): Promise<number> {
  if (command === "enable") return enableTotp(file, name, io);
  if (command === "disable") return disableTotp(file, name, io);
  io.err("Usage: dsh-auth user totp <enable|disable> <name> [--file <path>]");
  return 1;
}

async function enableTotp(file: string, name: string | undefined, io: TotpCliIo): Promise<number> {
  if (name === undefined || !USERNAME_RE.test(name)) {
    io.err("Usage: dsh-auth user totp enable <name> [--file <path>]");
    return 1;
  }
  const secret = generateTotpSecret();
  const saved = await mutate(file, io, (snapshot) => {
    const user = snapshot.users.get(name);
    if (user === undefined) throw new UsersFileError(`user ${name} not found`);
    if (user.totpSecret !== undefined) {
      throw new UsersFileError(`user ${name} already has a TOTP secret (disable first)`);
    }
    snapshot.users.set(name, { ...user, totpSecret: secret });
  });
  if (!saved) return 1;
  io.out(`TOTP secret for ${name}: ${secret}`);
  io.out(totpUri(name, secret));
  io.out("Add it to your authenticator app, then verify by logging in.");
  return 0;
}

async function disableTotp(file: string, name: string | undefined, io: TotpCliIo): Promise<number> {
  if (name === undefined) {
    io.err("Usage: dsh-auth user totp disable <name> [--file <path>]");
    return 1;
  }
  const saved = await mutate(file, io, (snapshot) => {
    const user = snapshot.users.get(name);
    if (user === undefined) throw new UsersFileError(`user ${name} not found`);
    const next = { ...user };
    delete next.totpSecret;
    snapshot.users.set(name, next);
  });
  if (!saved) return 1;
  io.out(`user ${name} TOTP disabled`);
  return 0;
}

/** 锁内变更 + 统一错误出口（enable/disable 自动获得锁/CAS/last-admin 保护）。 */
async function mutate(
  file: string,
  io: TotpCliIo,
  run: (snapshot: UsersSnapshot) => void,
): Promise<boolean> {
  try {
    await mutateUsersFile(file, run);
    return true;
  } catch (error) {
    io.err(errorMessage(error));
    return false;
  }
}

/** otpauth://totp/<issuer>:<name>?secret=<BASE32>&issuer=<issuer>（label 与 secret 均 URL 编码）。 */
export function totpUri(name: string, secret: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${name}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(TOTP_ISSUER)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof UsersFileError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
