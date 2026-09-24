/**
 * 改密成功后的去向（P1.1 / D24；D24.1 起改为**立即**跳转）。
 *
 * 服务端在返回 200 之前就已清掉 cookie 并吊销该用户的**全部**会话，所以客户端若停在设置
 * 面板上，等于停在一个"所有请求都会 401"的死会话 SPA 里。成功响应一到就把当前设备送回
 * 登录页，并带上白名单原因键，让登录卡片说明"为什么被登出"。
 *
 * 为什么不再留缓冲（D24.1）：宿主的全局 401 处理也会把人送向登录页，但它**不带**原因键；
 * 从"会话已死"到"对方发现"之间的每一毫秒都是竞态窗口，我们先走才稳拿 notice。成功文案与
 * 「重新登录」按钮仍留在面板上，作为导航被环境拒绝时的兜底（见 `account-form.tsx`）。
 *
 * 常量镜像：服务端 `src/features/password/login-notice.ts` 的 `PASSWORD_CHANGED_NOTICE`。
 * 客户端半边刻意不 import 服务端 `shared`（保持解耦、不打大 bundle）；两侧字面量由集成测试
 * 以源码文本比对钉住（`integration.p11-pins.test.ts`）。
 */
export declare const LOGIN_REDIRECT_URL = "/auth/login?next=%2F&notice=password-changed";
/** 跳到登录页；`nav` 只为测试注入（缺省走真实 `window.location.replace`）。 */
export declare function redirectToLogin(nav?: (url: string) => void): void;
//# sourceMappingURL=account-redirect.d.ts.map