/**
 * 反钓鱼身份块的 host 解析（D14）。登录页把「你在访问哪个实例」渲染成卡片上的身份块，
 * 用户靠它与地址栏的一致性识别钓鱼页；因此取值必须来自**运营侧配置**或**请求头 Host**，
 * 二者都不是请求体/查询串可控的输入。
 *
 * - `publicHost` 有值 → 用它（运营侧配置，不可被请求伪造；半外壳反代改写 Host 时唯一正确来源）；
 * - `publicHost` 为空 → 回退请求头 Host（直连/原样透传拓扑下的默认行为，向后兼容）。
 *
 * 顺手做运维容错：粘成 `https://host/path` 也能用（剥掉 scheme 与路径，只留 `host[:port]`）。
 * 注意：本函数只决定**展示文本**，不参与任何鉴权判定。
 */
export function resolvePublicHost(
  publicHost: string | undefined,
  requestHost: string | undefined,
): string {
  const configured = (publicHost ?? "").trim();
  if (configured === "") return requestHost ?? "";
  const withoutScheme = configured.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const [authority = ""] = withoutScheme.split("/");
  return authority.trim();
}
