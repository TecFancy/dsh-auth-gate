/**
 * 改密成功后的去向（P1.1 / D24）。
 *
 * 服务端在返回 200 之前就已清掉 cookie 并吊销该用户的**全部**会话，所以客户端若停在设置
 * 面板上，等于停在一个"所有请求都会 401"的死会话 SPA 里。由客户端把当前设备送回登录页，
 * 并带上白名单原因键，让登录卡片说明"为什么被登出"。
 *
 * 常量镜像：服务端 `src/features/password/login-notice.ts` 的 `PASSWORD_CHANGED_NOTICE`。
 * 客户端半边刻意不 import 服务端 `shared`（保持解耦、不打大 bundle）；两侧字面量由集成测试
 * 以源码文本比对钉住（`integration.password-change.test.ts` 的 source-pin 用例）。
 *
 * **跳转不绑组件生命周期**（复审结论）：成功那一刻会话已经死了，而成功态可能被宿主关弹窗、
 * 切分区、或 status 探针翻转拆掉。若把定时器挂在组件 effect 上，卸载就"取消跳转"，人反而被
 * 留在死会话壳里，与 D24 的目标相反。所以待跳定时器放在模块作用域：组件卸载、反复挂载都
 * 不影响；只有"又改了一次密码"（重排）或用户点「重新登录」（立刻跳）才会改变它。
 */
export declare const LOGIN_REDIRECT_URL = "/auth/login?next=%2F&notice=password-changed";
/** 成功提示的停留时长：够读完一行提示，又不至于让人以为界面卡住。 */
export declare const LOGIN_REDIRECT_DELAY_MS = 2500;
/** 清掉待跳（测试清理用；产品流程里跳转本身就会离开页面）。 */
export declare function cancelScheduledRedirect(): void;
/** 跳到登录页；`replace` 只为测试注入（缺省走真实 `window.location.replace`）。 */
export declare function redirectToLogin(replace?: (url: string) => void): void;
/** 成功态：约定时间后跳登录页。重复调用重排（Strict Mode 双挂载不会双跳）。 */
export declare function scheduleRedirectToLogin(nav?: (url: string) => void): void;
/** 「重新登录」按钮：立刻跳，并清掉待跳（幂等，允许连点）。 */
export declare function redirectToLoginNow(nav?: (url: string) => void): void;
//# sourceMappingURL=account-redirect.d.ts.map