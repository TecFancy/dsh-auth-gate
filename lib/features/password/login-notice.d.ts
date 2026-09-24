/**
 * 登录卡片「原因」提示（P1.1 / D24）。
 *
 * 场景：自助改密成功后服务端已清 cookie 并吊销全部会话，客户端把当前设备送回登录页
 * 并带上 `?notice=password-changed`，否则用户面对的是一张完全不解释「为什么被登出」
 * 的登录卡。
 *
 * 纪律（沿用 D20 的反反射约定）：
 * - 只认**精确白名单键**；其他值（注入串 / 超长 / 空 / 重复参数）一律忽略；
 *  - 文案只能是本文件里的常量，绝不拼接请求文本 → 无反射型 XSS、无开放重定向文案；
 *  - 未知键不报错也不记日志（登录页可被爬，别把噪声写进日志）。
 */
export declare const PASSWORD_CHANGED_NOTICE = "password-changed";
/** 改密后的登录卡提示（英文：登录卡片整体是服务端渲染英文，与 D20 失败文案同语言）。 */
export declare const PASSWORD_CHANGED_TEXT = "Your password was changed. Sign in with your new password.";
/** 白名单解析：命中返回常量文案，否则 undefined（缺省时卡片不渲染 notice 槽）。 */
export declare function resolveLoginNotice(value: string | null | undefined): string | undefined;
//# sourceMappingURL=login-notice.d.ts.map