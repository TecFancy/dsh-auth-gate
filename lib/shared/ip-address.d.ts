/** 归一化后的 CIDR 网络。 */
export interface CidrNetwork {
    /** 网络地址（IPv4 4 字节 / IPv6 16 字节）。 */
    bytes: number[];
    /** 前缀长度（IPv4 0-32 / IPv6 0-128）。 */
    prefix: number;
}
/**
 * 归一化 IP 字面量：去装饰、小写、IPv4-mapped 折成点分四段、IPv6 压成 RFC 5952 形式。
 * 非 IP（`""`、`"unknown"`、超长垃圾）→ `""`，调用方据此回退，绝不把垃圾当桶 key。
 */
export declare function normalizeIp(raw: string | undefined): string;
/** `a.b.c.d/n`、`[v6]/n` → CidrNetwork；非 CIDR / 非法地址 / 前缀越界 → undefined。 */
export declare function parseCidr(raw: string | undefined): CidrNetwork | undefined;
/** `address` 是否落在 `network` 内（地址族不同直接 false；`address` 先归一化）。 */
export declare function cidrContains(network: CidrNetwork, address: string): boolean;
//# sourceMappingURL=ip-address.d.ts.map