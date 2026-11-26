/**
 * 锁定文案（429，D20）：口令段、TOTP 段与 token 段渲染的是同一张卡片上的同一句话。
 *
 * 按「这个网络」而非「你的账号」陈述，因为锁定桶按客户端 IP 计（#82），说「你的账号」会
 * 指控错人；不显示剩余次数，也不承诺自助重置（本产品没有）。文案只由 `retry-after` 整数
 * 生成，绝不读 query、绝不反射请求文本。
 *
 * 住在 `shared/` 而不是某个 feature 切片：三个调用点分属两个切片，features 之间不能互相
 * import（D30 / `slice:check`）。
 */
export function lockoutMessage(retryAfterSeconds: number): string {
  const unit = retryAfterSeconds === 1 ? "second" : "seconds";
  return (
    "Too many sign-in attempts from this network. " +
    `Try again in ${retryAfterSeconds} ${unit}. ` +
    "There is no password reset, so ask the instance owner if you are stuck."
  );
}
