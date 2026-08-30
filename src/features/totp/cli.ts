import { generateTotpSecret } from "./totp.js";
import {
  loadUsersFile,
  USERNAME_RE,
  writeUsersFile,
  type UsersSnapshot,
  UsersFileError,
} from "../../shared/index.js";

/** otpauth URI 的 issuer（M4 T3）。 */
const TOTP_ISSUER = "dsh-auth";

export interface TotpCliIo {
  out(line: string): void;
  err(line: string): void;
}

/**
 * `dsh-auth user totp <enable|disable> <name>`（M4 T14）。
 * enable：生成新 secret（已存在则拒绝），写回 users.yaml，输出 base32 + otpauth URI。
 * disable：移除 secret（幂等）。
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
  let snapshot: UsersSnapshot;
  try {
    snapshot = (await loadUsersFile(file)).snapshot;
  } catch (error) {
    io.err(errorMessage(error));
    return 1;
  }
  const user = snapshot.users.get(name);
  if (user === undefined) {
    io.err(`user ${name} not found`);
    return 1;
  }
  if (user.totpSecret !== undefined) {
    io.err(`user ${name} already has a TOTP secret (disable first)`);
    return 1;
  }
  const secret = generateTotpSecret();
  try {
    snapshot.users.set(name, { ...user, totpSecret: secret });
    await writeUsersFile(file, snapshot);
  } catch (error) {
    io.err(errorMessage(error));
    return 1;
  }
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
  let snapshot: UsersSnapshot;
  try {
    snapshot = (await loadUsersFile(file)).snapshot;
  } catch (error) {
    io.err(errorMessage(error));
    return 1;
  }
  const user = snapshot.users.get(name);
  if (user === undefined) {
    io.err(`user ${name} not found`);
    return 1;
  }
  try {
    snapshot.users.set(name, { passwordHash: user.passwordHash, disabled: user.disabled });
    await writeUsersFile(file, snapshot); // 幂等：无 secret 也照写（重建对象不含 totpSecret）
  } catch (error) {
    io.err(errorMessage(error));
    return 1;
  }
  io.out(`user ${name} TOTP disabled`);
  return 0;
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
