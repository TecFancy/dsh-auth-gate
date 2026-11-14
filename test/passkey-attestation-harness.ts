/**
 * 测试专用 attestation 生成器（`fmt: "none"`，EC P-256）。
 *
 * 与 `passkey-authenticator-harness.ts` 分开：那个文件已接近 250 行上限，而注册流程需要
 * 手写 CBOR 的 attestationObject（`{fmt, attStmt, authData}`）与 authData 的 attested
 * credential data 段。这里只做「造一个库能验过的 attestation」，不做签名校验。
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { encodeCoseP256 } from "./passkey-authenticator-harness.js";

/** 注册提交给 `/auth/passkey/register` 的 urlencoded 扁平字段。 */
export interface PasskeyAttestationForm {
  readonly id: string;
  readonly client_data_json: string;
  readonly attestation_object: string;
}

/** 一次注册的可调参数（默认值即「一次正常注册」）。 */
export interface AttestOptions {
  readonly challenge: string;
  readonly origin: string;
  /** authData 的 flags 字节；默认 0x45 = UP | UV | AT。 */
  readonly flags?: number;
  /** 认证器计数器；默认 0。 */
  readonly counter?: number;
  /** clientDataJSON 的 type 覆盖值；默认 `webauthn.create`。 */
  readonly type?: string;
  /** 覆盖 credentialId（base64url）；默认用实例自己的。 */
  readonly credentialId?: string;
}

const BASE64URL = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** canonical CBOR 头部（major type + 长度/值；测试样本都 < 65536）。 */
function cborHead(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const buffer = Buffer.alloc(3);
  buffer[0] = (major << 5) | 25;
  buffer.writeUInt16BE(value, 1);
  return buffer;
}

/** CBOR bstr。 */
function cborBytes(bytes: Uint8Array): Buffer {
  return Buffer.concat([cborHead(2, bytes.length), Buffer.from(bytes)]);
}

/** CBOR tstr。 */
function cborText(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([cborHead(3, bytes.length), bytes]);
}

/** CBOR map（键值对按给定顺序写入；canonical 顺序由调用方保证）。 */
function cborMap(pairs: readonly (readonly [Buffer, Buffer])[]): Buffer {
  const parts: Buffer[] = [cborHead(5, pairs.length)];
  for (const [key, value] of pairs) parts.push(key, value);
  return Buffer.concat(parts);
}

/** 4 字节大端计数器。 */
function counterBytes(counter: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(counter >>> 0, 0);
  return buffer;
}

/**
 * 一把能产出 `fmt: "none"` attestation 的测试认证器。
 *
 * 与 `PasskeyAuthenticator` 的区别：那个只做断言（get），这个只做注册（create）。
 * 两者共用 `encodeCoseP256`，因此注册落盘的公钥与后续断言验签天然一致。
 */
export class PasskeyAttestationAuthenticator {
  /** base64url credentialId（与 `users.yaml` 记录逐字一致）。 */
  readonly credentialId: string;
  /** base64url 原始 COSE 公钥（写进 `users.yaml` 的 `publicKeyCose`）。 */
  readonly publicKeyCose: string;
  private readonly rpId: string;
  private readonly cose: Buffer;

  constructor(options: { readonly rpId: string; readonly credentialId?: string }) {
    this.rpId = options.rpId;
    this.credentialId = options.credentialId ?? BASE64URL(Buffer.alloc(16, 9));
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.publicKeyCose = encodeCoseP256(publicKey.export({ format: "jwk" }));
    this.cose = Buffer.from(this.publicKeyCose, "base64url");
  }

  /** 产出一条 `webauthn.create` attestation（字段名即表单体字段名）。 */
  attest(options: AttestOptions): PasskeyAttestationForm {
    const credentialId = Buffer.from(options.credentialId ?? this.credentialId, "base64url");
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: options.type ?? "webauthn.create",
        challenge: options.challenge,
        origin: options.origin,
        crossOrigin: false,
      }),
    );
    const authData = Buffer.concat([
      createHash("sha256").update(this.rpId).digest(),
      Buffer.from([options.flags ?? 0x45]),
      counterBytes(options.counter ?? 0),
      Buffer.alloc(16, 0), // aaguid：全零 = 未知认证器
      credentialIdLength(credentialId.length),
      credentialId,
      this.cose,
    ]);
    const attestationObject = cborMap([
      [cborText("fmt"), cborText("none")],
      [cborText("attStmt"), cborMap([])],
      [cborText("authData"), cborBytes(authData)],
    ]);
    return {
      id: BASE64URL(credentialId),
      client_data_json: BASE64URL(clientDataJSON),
      attestation_object: BASE64URL(attestationObject),
    };
  }
}

/** credentialId 的 2 字节大端长度前缀。 */
function credentialIdLength(length: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(length, 0);
  return buffer;
}

/** 供测试构造「BE=1/BS=1」的 authData flags（UP | UV | AT | BE | BS）。 */
export const ATTESTED_FLAGS_BACKED_UP = 0x5d;

/** 供测试构造「BE=0/BS=1」的非法组合（UP | UV | AT | BS）。 */
export const ATTESTED_FLAGS_INVALID_BACKUP = 0x55;
