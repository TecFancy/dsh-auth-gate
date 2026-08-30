export interface TotpCliIo {
    out(line: string): void;
    err(line: string): void;
}
/**
 * `dsh-auth user totp <enable|disable> <name>`（M4 T14）。
 * enable：生成新 secret（已存在则拒绝），写回 users.yaml，输出 base32 + otpauth URI。
 * disable：移除 secret（幂等）。
 */
export declare function handleUserTotp(file: string, command: string | undefined, name: string | undefined, io: TotpCliIo): Promise<number>;
/** otpauth://totp/<issuer>:<name>?secret=<BASE32>&issuer=<issuer>（label 与 secret 均 URL 编码）。 */
export declare function totpUri(name: string, secret: string): string;
//# sourceMappingURL=cli.d.ts.map