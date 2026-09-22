/**
 * 反钓鱼身份块的 host 解析（D14）。登录页把「你在访问哪个实例」渲染成卡片上的身份块，
 * 用户靠它与地址栏的一致性识别钓鱼页；因此取值必须来自**运营侧配置**或**请求头 Host**，
 * 二者都不是请求体/查询串可控的输入。
 *
 * - `publicHost` 有值 → 用它（运营侧配置，不可被请求伪造；半外壳反代改写 Host 时唯一正确来源）；
 * - `publicHost` 为空 → 回退请求头 Host（直连/原样透传拓扑下的默认行为，向后兼容）。
 *
 * 顺手做运维容错：粘成 `https://host/path`、`//host` 也能用（剥 scheme、userinfo、路径、
 * 查询与片段，只留 `host[:port]`）；归一化后为空（`"/"`、`"https://"`）则回退请求头，
 * 避免身份块凭空消失。
 *
 * 注意：本函数只决定**展示文本**，不参与任何鉴权判定。
 */
export function resolvePublicHost(
  publicHost: string | undefined,
  requestHost: string | undefined,
): string {
  const configured = (publicHost ?? "").trim();
  if (configured === "") return requestHost ?? "";
  const normalized = normalizeHost(configured);
  return normalized === "" ? (requestHost ?? "") : normalized;
}

/** 只保留 `host[:port]`：剥 scheme、userinfo、路径、查询与片段。 */
function normalizeHost(value: string): string {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const authority = withoutScheme.replace(/^\/+/, "").split(/[/?#]/)[0] ?? "";
  // userinfo（`user:pass@host`）不能进展示：配置写错会把凭据印给每个访客。
  return authority.slice(authority.lastIndexOf("@") + 1).trim();
}
