import { type PasskeyLoginOptions } from "./passkey-login.js";
export interface LoginPageOptions {
    /** 当前实例的 origin/host（反钓鱼身份块）；空串或缺省时不渲染该行。 */
    host?: string | undefined;
    /** 已通过第一段的账号名（仅 TOTP 段拿得到），渲染为 "Signing in as ..."。 */
    who?: string | undefined;
    /** 「换一个账号」回退链接（仅 TOTP 段）；服务端需在该 GET 上清掉挑战 cookie。 */
    resetHref?: string | undefined;
    /**
     * 失败页回填的用户名（D20）：未知用户 / 错口令 / 禁用三态**同样回填**，
     * 否则「只有真用户才回填」本身就是账号存在性预言机。密码字段永不回填。
     */
    username?: string | undefined;
    /**
     * 卡片顶部的「原因」提示（P1.1 / D24）。只接受服务端白名单常量（调用方负责），
     * 绝不来自请求文本：本字段一律 escapeHtml，且不改变 error/hint 槽语义。
     */
    notice?: string | undefined;
    /**
     * passkey 登录入口（M6 §5.7）。缺省或 `enabled: false` → 页面与旧版逐字相同；
     * `conditionalUi` 只影响内联脚本与用户名框的 autocomplete 提示，不改变口令路径。
     */
    passkey?: PasskeyLoginOptions | undefined;
}
export interface FieldSpec {
    id: string;
    label: string;
    name: string;
    autocomplete: string;
    placeholder: string;
    type: "text" | "password";
    /** M2 §4.4 / M3 P13 冻结要求：token 字段与 password 表单的密码字段需要它。 */
    autofocus?: boolean;
    /** 表单级错误时标记该字段（密码/令牌/验证码），配 aria-describedby 指向错误槽。 */
    invalid?: boolean;
    /** 回填值（走 escapeHtml；仅非空时渲染 value，密码字段一律不设）。 */
    value?: string | undefined;
    /** 附加 HTML 属性字符串（原样拼入 input 标签；调用方保证转义）。 */
    attrs?: string;
    /** 额外 class（如 TOTP 的 code）。 */
    className?: string | undefined;
}
export interface LoginCardOptions {
    /** 文档标题（<title>）。 */
    title: string;
    /** kicker 文案（<h1>）：Sign in / Two-factor。 */
    kicker: string;
    /** 副标题/hint 文案；缺省不渲染。 */
    hint?: string | undefined;
    /** 每个字段：id/label/name/autocomplete/placeholder/type。 */
    fields: FieldSpec[];
    submitLabel: string;
    next: string;
    /** 显式允许 undefined：公开函数透传 `error?: string`（exactOptionalPropertyTypes）。 */
    error?: string | undefined;
    options?: LoginPageOptions | undefined;
    /** 仅 TOTP 段注入的内联增强脚本。 */
    script?: string | undefined;
    /** 追加到共享样式表末尾的页面专属样式（passkey 按钮；token/TOTP 页不传）。 */
    style?: string | undefined;
    /** 插在口令表单之后、回退链接之前的片段（passkey 入口；token/TOTP 页不传）。 */
    afterForm?: string | undefined;
    /**
     * `false` = 不渲染 `<form>` 骨架（passkey-only 页：没有可提交的字段，登录走 passkey 自己的
     * 隐藏表单）。此时 `fields`/`submitLabel`/`next` 都不参与渲染，`afterForm` 直接落在卡片主体里。
     */
    form?: false | undefined;
}
/** 渲染公共卡片骨架（kicker/host/错误槽/hint/表单/页脚），全部动态文本 HTML-escape。 */
export declare function renderLoginCard(spec: LoginCardOptions): string;
/** token 模式登录页：单字段（共享访问令牌），恒时校验由端点负责。 */
export declare function loginPageHtml(next: string, error?: string, options?: LoginPageOptions): string;
/** password 模式登录页（P13）：username + password 两字段，同款卡片样式。 */
export declare function passwordLoginPageHtml(next: string, error?: string, options?: LoginPageOptions): string;
/** TOTP 挑战页（M4 T6）：单验证码字段，两段式登录第二段。 */
export declare function totpChallengePageHtml(next: string, error?: string, options?: LoginPageOptions): string;
//# sourceMappingURL=login-page.d.ts.map