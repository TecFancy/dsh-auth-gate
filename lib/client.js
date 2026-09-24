window.__ModuleLoader__.load({
	id: "dsh-auth-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/account-copy.ts
		/** 本面板用到的词典键（集中常量，避免散落字符串）。 */
		const ACCOUNT_KEYS = {
			nav: "account",
			title: "account.title",
			intro: "account.intro",
			/** 作用域说明（P1.1）：0.1.7 起宿主有官方「账户」段，这里要讲清"管的是本地登录凭据"。 */
			scope: "account.scope",
			loading: "account.loading",
			loginRequired: "account.loginRequired",
			current: "account.current",
			password: "account.password",
			confirm: "account.confirm",
			code: "account.code",
			codeHint: "account.codeHint",
			policyHint: "account.policyHint",
			submit: "account.submit",
			submitting: "account.submitting",
			success: "account.success",
			/**
			* 成功态按钮（P1.1 / D24）：不再是「关闭」：服务端此刻已吊销全部会话，关掉弹窗只会
			* 停在「死会话 SPA」上；改为直接去登录页。
			*/
			relogin: "account.relogin",
			currentRequired: "account.currentRequired",
			passwordRequired: "account.passwordRequired",
			mismatch: "account.mismatch",
			invalidCredentials: "account.invalidCredentials",
			invalidTotp: "account.invalidTotp",
			policyIntro: "account.policyIntro",
			locked: "account.locked",
			lockedPlain: "account.lockedPlain",
			unavailable: "account.unavailable",
			generic: "account.generic",
			ruleMinLength: "account.rule.minLength",
			ruleMaxLength: "account.rule.maxLength",
			ruleUppercase: "account.rule.uppercase",
			ruleLowercase: "account.rule.lowercase",
			ruleDigit: "account.rule.digit",
			ruleSpecial: "account.rule.special",
			ruleSameAsOld: "account.rule.sameAsOld"
		};
		/** 契约 §2 策略规则名 → 词典键。 */
		const RULE_KEYS = {
			minLength: ACCOUNT_KEYS.ruleMinLength,
			maxLength: ACCOUNT_KEYS.ruleMaxLength,
			uppercase: ACCOUNT_KEYS.ruleUppercase,
			lowercase: ACCOUNT_KEYS.ruleLowercase,
			digit: ACCOUNT_KEYS.ruleDigit,
			special: ACCOUNT_KEYS.ruleSpecial,
			sameAsOld: ACCOUNT_KEYS.ruleSameAsOld
		};
		/** 规则名翻译；未知规则原样回显（不发明契约之外的文案）。 */
		function ruleText(rule, t) {
			const key = RULE_KEYS[rule];
			return key === void 0 ? rule : t(key);
		}
		/** host locale 的插值规则（`{name}`；缺参数时保留占位符不吞字）。 */
		function formatCopy(template, params) {
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
		}
		/** 用一套词典兜底成 translate（槽位未注入 `t` 时降级为英文，不显示键名）。 */
		function translateFrom(dict) {
			return (key, params) => formatCopy(dict[key] ?? key, params);
		}
		/** 中文词典。 */
		const ACCOUNT_DICT_ZH = {
			[ACCOUNT_KEYS.nav]: "账号安全",
			[ACCOUNT_KEYS.title]: "修改密码",
			[ACCOUNT_KEYS.intro]: "改密成功后，当前设备也会被登出，需要用新密码重新登录。",
			[ACCOUNT_KEYS.scope]: "这里是本实例的本地登录凭据，与 DeepSeek 云账户无关。",
			[ACCOUNT_KEYS.loading]: "正在确认登录状态...",
			[ACCOUNT_KEYS.loginRequired]: "请先登录后再修改密码。",
			[ACCOUNT_KEYS.current]: "当前密码",
			[ACCOUNT_KEYS.password]: "新密码",
			[ACCOUNT_KEYS.confirm]: "确认新密码",
			[ACCOUNT_KEYS.code]: "动态验证码",
			[ACCOUNT_KEYS.codeHint]: "已开启两步验证时填写 6 位动态码，否则留空。",
			[ACCOUNT_KEYS.policyHint]: "新密码至少 14 个字符，且包含大写字母、小写字母、数字和特殊字符，不能与当前密码相同。",
			[ACCOUNT_KEYS.submit]: "修改密码",
			[ACCOUNT_KEYS.submitting]: "提交中...",
			[ACCOUNT_KEYS.success]: "密码已改，请重新登录。当前设备也已登出。",
			[ACCOUNT_KEYS.relogin]: "重新登录",
			[ACCOUNT_KEYS.currentRequired]: "请输入当前密码。",
			[ACCOUNT_KEYS.passwordRequired]: "请输入新密码。",
			[ACCOUNT_KEYS.mismatch]: "两次输入的新密码不一致。",
			[ACCOUNT_KEYS.invalidCredentials]: "当前密码不正确。",
			[ACCOUNT_KEYS.invalidTotp]: "动态验证码不正确，或该验证码已被使用，请等待下一枚验证码后重试。",
			[ACCOUNT_KEYS.policyIntro]: "新密码不符合以下要求：",
			[ACCOUNT_KEYS.locked]: "尝试次数过多，请在 {seconds} 秒后重试。",
			[ACCOUNT_KEYS.lockedPlain]: "尝试次数过多，请稍后重试。",
			[ACCOUNT_KEYS.unavailable]: "服务暂时不可用，请稍后重试。",
			[ACCOUNT_KEYS.generic]: "修改失败，请稍后重试。",
			[ACCOUNT_KEYS.ruleMinLength]: "至少 14 个字符",
			[ACCOUNT_KEYS.ruleMaxLength]: "不超过 256 个字符",
			[ACCOUNT_KEYS.ruleUppercase]: "包含大写字母",
			[ACCOUNT_KEYS.ruleLowercase]: "包含小写字母",
			[ACCOUNT_KEYS.ruleDigit]: "包含数字",
			[ACCOUNT_KEYS.ruleSpecial]: "包含特殊字符（非字母数字）",
			[ACCOUNT_KEYS.ruleSameAsOld]: "不能与当前密码相同"
		};
		/** 英文词典。 */
		const ACCOUNT_DICT_EN = {
			[ACCOUNT_KEYS.nav]: "Account security",
			[ACCOUNT_KEYS.title]: "Change password",
			[ACCOUNT_KEYS.intro]: "After the change, this device is signed out too. Sign in again with your new password.",
			[ACCOUNT_KEYS.scope]: "These are this instance's local sign-in credentials, not your DeepSeek account.",
			[ACCOUNT_KEYS.loading]: "Checking your session...",
			[ACCOUNT_KEYS.loginRequired]: "Sign in first to change your password.",
			[ACCOUNT_KEYS.current]: "Current password",
			[ACCOUNT_KEYS.password]: "New password",
			[ACCOUNT_KEYS.confirm]: "Confirm new password",
			[ACCOUNT_KEYS.code]: "Verification code",
			[ACCOUNT_KEYS.codeHint]: "Enter the 6-digit code when two-factor authentication is on, otherwise leave it empty.",
			[ACCOUNT_KEYS.policyHint]: "At least 14 characters with an uppercase letter, a lowercase letter, a digit and a special character; it must differ from the current password.",
			[ACCOUNT_KEYS.submit]: "Change password",
			[ACCOUNT_KEYS.submitting]: "Submitting...",
			[ACCOUNT_KEYS.success]: "Password changed. Please sign in again. This device has been signed out too.",
			[ACCOUNT_KEYS.relogin]: "Sign in again",
			[ACCOUNT_KEYS.currentRequired]: "Enter your current password.",
			[ACCOUNT_KEYS.passwordRequired]: "Enter a new password.",
			[ACCOUNT_KEYS.mismatch]: "The two new passwords do not match.",
			[ACCOUNT_KEYS.invalidCredentials]: "The current password is incorrect.",
			[ACCOUNT_KEYS.invalidTotp]: "The verification code is incorrect or already used; wait for the next code and try again.",
			[ACCOUNT_KEYS.policyIntro]: "The new password does not meet these requirements:",
			[ACCOUNT_KEYS.locked]: "Too many attempts. Try again in {seconds} seconds.",
			[ACCOUNT_KEYS.lockedPlain]: "Too many attempts. Try again later.",
			[ACCOUNT_KEYS.unavailable]: "The service is temporarily unavailable. Please try again later.",
			[ACCOUNT_KEYS.generic]: "Could not change the password. Please try again later.",
			[ACCOUNT_KEYS.ruleMinLength]: "at least 14 characters",
			[ACCOUNT_KEYS.ruleMaxLength]: "at most 256 characters",
			[ACCOUNT_KEYS.ruleUppercase]: "an uppercase letter",
			[ACCOUNT_KEYS.ruleLowercase]: "a lowercase letter",
			[ACCOUNT_KEYS.ruleDigit]: "a digit",
			[ACCOUNT_KEYS.ruleSpecial]: "a special character (not a letter or digit)",
			[ACCOUNT_KEYS.ruleSameAsOld]: "different from the current password"
		};
		//#endregion
		//#region src/client/account-icon.ts
		/**
		* 自设计图标（P1.1 / D24）：「盾 + 钥匙孔」，16px outline，规格对齐宿主图标
		* （`fill:none` / `stroke:currentColor` / `stroke-width:1.5` / 圆角线端）。
		*
		* 为什么自设计：宿主 `settings.section` 只投影 `id`/`order`/`label`，导航图标由
		* `dsh-client-ui-settings-general` 的 `navIcon(id)` 硬编码 if 链决定（0.1.5-rc.2 与
		* 0.1.7-alpha.2 都如此，且没有 `icon` 选项）。插件侧没有官方挂载点，也**不去改宿主的
		* nav DOM**（与宿主 React 抢树，评审已否掉），所以图标只画在我们自己的内容区标题行
		* （见 `account-form.tsx` 的 AccountIcon）。
		*
		* 路径数据与 `docs/demo/account-security.svg` 同源，由 `account-icon.test.ts` 逐条比对；
		* 改一处必须同步另一处。
		*/
		const ACCOUNT_ICON_VIEW_BOX = "0 0 16 16";
		/** 图标路径（两个 `d`：盾牌外框 + 钥匙孔圆与柄）。 */
		const ACCOUNT_ICON_PATHS = ["M8 1.7 13.1 3.55V7.9c0 3.05-2.08 5.42-5.1 6.4-3.02-.98-5.1-3.35-5.1-6.4V3.55Z", "M9.3 7a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 1 1 2.6 0M8 8.3v2.1"];
		//#endregion
		//#region src/client/account-nav-icon.ts
		/**
		* 「账号安全」导航行图标：临时 DOM 垫片（D24.1）。
		*
		* **为什么需要它**：宿主 `settings.section` 只投影 `id`/`order`/`label`，导航图标由
		* `@deepseek-ai/dsh-client-ui-settings-general` 里硬编码的 `navIcon(id)` if 链给出
		* （0.1.5-rc.2 只认 models / agent-presets / plugins，0.1.7-alpha.2 多认官方 `account`），
		* 第三方段一律落到默认齿轮。插件侧没有图标挂载点，所以这里只对我们自己那一行做一次
		* 视觉替换：把宿主齿轮 `display:none`，在它前面插进我们自设计的盾牌 SVG。
		*
		* **不闪**：观察器在插件 `apply()` 时就装好，远早于设置浮层出现；宿主 React 提交 DOM 后，
		* MutationObserver 回调作为**微任务**在同一个任务里排队，而浏览器绘制发生在微任务清空之后。
		* 因此"宿主图标进入 DOM / 被重写内联样式"这件事总是在画出那一帧之前被修正为"藏起来 + 我们的
		* 图标在场"，无论它发生在浮层整体插入的同一次提交、还是后来的某一次提交（后到的那次插入本身
		* 也会触发回调）。隔离实例里用 rAF 逐帧探针（每帧记录行内图标状态）验过：出现行的第一帧即已是
		* 盾牌，0 帧出现齿轮。
		*
		* **只碰我们这一行**：判定条件是「`<button>` 的最后一个元素子节点是 `<span>` 且文本等于
		* `账号安全` / `Account security`，并且至少有一颗直接子 `<svg>`」（宿主导航行的形：
		* `[icon, label]`）。找不到、宿主换了结构、或页面里还没有这一行时**什么都不做**，用户看到的
		* 仍是宿主齿轮，不会更糟。
		*
		* **自愈**：每次相关 DOM 变化都重跑同步（藏掉行内**直接子级**里除我们之外的所有 svg，缺了就补一个），
		* 因此宿主重渲染、重复同步都不会留下重复图标。disposer 断开观察器并**恢复现场**
		* （宿主齿轮回来、我们的图标摘掉），让卸载回到"没装过"的样子。
		*
		* **上游支持后整体删除**：dsh 给 `settings.section` 加 `icon` 选项（或 `navIcon` 认插件 id）
		* 之日，删掉本文件与 `index.tsx` 里的安装调用，改走官方字段；迁移条件见 ADR D24.1
		* （`docs/decisions/implemented/2026-09-23-post-change-redirect-and-nav-identity.zh.md`）。
		*/
		/** 贴在我们插入的 `<svg>` 上的标记属性：宿主不会写它，重同步时靠它认出自己。 */
		const NAV_GLYPH_ATTR = "data-dsh-auth-gate-glyph";
		/** SVG 命名空间。 */
		const SVG_NS = "http://www.w3.org/2000/svg";
		/** 我们这一行的文案（zh/en 两套）：宿主按活动语言投影 `label`，两种都要认出来。 */
		const NAV_LABELS = collectLabels();
		/** 从两份词典取导航标签（空值不进表，避免匹配到无关的空 label 行）。 */
		function collectLabels() {
			const labels = [];
			for (const dict of [ACCOUNT_DICT_ZH, ACCOUNT_DICT_EN]) {
				const label = dict[ACCOUNT_KEYS.nav];
				if (label !== void 0 && label.length > 0) labels.push(label);
			}
			return labels;
		}
		/** 直接子级的 `<svg>`（不含 label span 里可能的装饰图元，也不含更深的后代）。 */
		function directSvgs(button) {
			return Array.from(button.children).filter((child) => child instanceof SVGElement);
		}
		/** 宿主行结构：`<button>[icon, <span>label</span>]`；只认这种形，别的一律不碰。 */
		function isAccountRow(button) {
			if (button.tagName !== "BUTTON") return false;
			const label = button.lastElementChild;
			if (label?.tagName !== "SPAN") return false;
			if (directSvgs(button).length === 0) return false;
			return NAV_LABELS.includes((label.textContent ?? "").trim());
		}
		/** 造盾牌图标（路径数据与内容区标题行、`docs/demo/account-security.svg` 同源）。 */
		function createGlyph(doc) {
			const svg = doc.createElementNS(SVG_NS, "svg");
			svg.setAttribute(NAV_GLYPH_ATTR, "1");
			svg.setAttribute("viewBox", ACCOUNT_ICON_VIEW_BOX);
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
			svg.setAttribute("fill", "none");
			svg.setAttribute("stroke", "currentColor");
			svg.setAttribute("stroke-width", "1.5");
			svg.setAttribute("stroke-linecap", "round");
			svg.setAttribute("stroke-linejoin", "round");
			svg.setAttribute("aria-hidden", "true");
			svg.setAttribute("focusable", "false");
			svg.style.flex = "none";
			for (const d of ACCOUNT_ICON_PATHS) {
				const path = doc.createElementNS(SVG_NS, "path");
				path.setAttribute("d", d);
				svg.appendChild(path);
			}
			return svg;
		}
		/**
		* 把这一行同步成"宿主图标藏起来、我们的图标在场"。
		*
		* 幂等：已有我们的图标就只做隐藏；宿主换了行内结构（没有直接子 svg 可换）则放手不动。
		* 只藏**直接子级**的 svg（宿主以后在同一行加 chevron / 徽标也不会被误伤）。
		* 返回是否真的动过 DOM，供调用方早退。
		*/
		function syncRow(button) {
			if (button.lastElementChild === null) return false;
			const svgs = directSvgs(button);
			let glyph = svgs.find((svg) => svg.hasAttribute("data-dsh-auth-gate-glyph")) ?? null;
			if (glyph === null) {
				const host = svgs[0];
				if (host === void 0) return false;
				glyph = createGlyph(button.ownerDocument);
				button.insertBefore(glyph, host);
			}
			for (const svg of directSvgs(button)) if (svg !== glyph) svg.style.display = "none";
			return true;
		}
		/** 扫一遍容器里的候选行（首次安装、整块浮层被插入时用）。 */
		function syncRowsIn(scope) {
			for (const button of scope.querySelectorAll("button")) if (isAccountRow(button)) syncRow(button);
		}
		/** 节点自己落在我们那一行里（宿主重渲染换掉行内图标）：重同步所在行。 */
		function syncOwner(node) {
			const owner = node.closest("button");
			if (owner !== null && isAccountRow(owner)) syncRow(owner);
		}
		/** 新增节点可能整块包含设置浮层（含我们那一行），也可能本身就在我们那一行里。 */
		function syncAdded(node) {
			syncOwner(node);
			if (node.querySelector("button") === null) return;
			syncRowsIn(node);
		}
		/** 卸载时恢复现场：摘掉我们插的图标、去掉宿主图标上的内联 `display`（不动别的行）。 */
		function restoreRows(doc) {
			for (const glyph of doc.querySelectorAll(`svg[${NAV_GLYPH_ATTR}]`)) {
				const button = glyph.parentElement;
				glyph.remove();
				if (button === null) continue;
				for (const svg of directSvgs(button)) svg.style.display = "";
			}
		}
		/**
		* 装上垫片：先立即同步一次（浮层可能已经开着），再盯着后续 DOM 变化
		* （设置浮层按需挂载，且宿主随时可能重渲染导航行）。
		*
		* 观察 childList（节点进出）+ `style` 属性：宿主把行内图标换成新节点、或在这颗 svg 上重写
		* 内联样式，都要能把齿轮重新藏回去。属性只过滤 `style`，且回调里对非按钮祖先直接早退，
		* 所以动画/流式输出带来的样式变更只是一次很便宜的 `closest()`。
		*
		* `doc === undefined`（node 单测环境没有 DOM）时是 no-op。返回的 disposer 断开观察器并把
		* 受影响的行恢复原样（宿主齿轮回来、我们的图标摘掉）；重复调用 install 会各自装一个观察器，
		* 正常情况下一个页面只装一次。
		*/
		function installAccountNavIcon(doc) {
			if (doc === void 0) return () => void 0;
			syncRowsIn(doc);
			const observer = new MutationObserver((records) => {
				for (const record of records) {
					if (record.target.nodeType === 1) syncOwner(record.target);
					for (const node of record.addedNodes) if (node.nodeType === 1) syncAdded(node);
				}
			});
			observer.observe(doc.documentElement, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["style"]
			});
			return () => {
				observer.disconnect();
				restoreRows(doc);
			};
		}
		//#endregion
		//#region src/client/account-redirect.ts
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
		const LOGIN_REDIRECT_URL = "/auth/login?next=%2F&notice=password-changed";
		/** 跳到登录页；`nav` 只为测试注入（缺省走真实 `window.location.replace`）。 */
		function redirectToLogin(nav = defaultReplace) {
			nav(LOGIN_REDIRECT_URL);
		}
		/**
		* 真实导航用 `replace` 而不是 `assign`：此刻当前页是**已登出的死会话壳**，
		* 若留在历史栈里，用户登录后按返回键会回到"看起来还在设置、其实已失效"的页面
		* （还可能命中 bfcache 把旧内存态复活）。replace 让这条死路径不进入历史。
		*/
		function defaultReplace(url) {
			window.location.replace(url);
		}
		//#endregion
		//#region src/client/account-styles.ts
		/**
		* account 面板样式：颜色只取宿主设计 token（`--dsw-*`），不硬编码色值，
		* 跟随主题/明暗切换。几何（间距/圆角/字号）照 logout-action.tsx 现状自绘。
		*/
		/** 面板根部：纵向排布；`minHeight: 0` 让本页在设置内容列里参与收缩，列内可滚动。 */
		const PANEL_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			minHeight: 0,
			padding: "4px 0 8px",
			color: "var(--dsw-alias-label-primary)",
			fontFamily: "var(--dsw-font-family)"
		};
		const TITLE_STYLE = {
			margin: 0,
			fontSize: 16,
			fontWeight: 600,
			lineHeight: "24px",
			color: "var(--dsw-alias-label-primary)"
		};
		/** 标题行（P1.1）：自带图标 + 文案横排，图标随文字色（currentColor）跟随主题。 */
		const TITLE_ROW_STYLE = {
			...TITLE_STYLE,
			display: "flex",
			alignItems: "center",
			gap: 8
		};
		const HINT_STYLE = {
			margin: 0,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const FORM_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			maxWidth: 420
		};
		const LABEL_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 6,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-secondary)"
		};
		/** 输入框基线。 */
		const INPUT_BASE = {
			boxSizing: "border-box",
			width: "100%",
			padding: "8px 12px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-2)",
			color: "var(--dsw-alias-label-primary)",
			fontFamily: "inherit",
			fontSize: 14,
			lineHeight: "22px"
		};
		const INPUT_STYLE = INPUT_BASE;
		/** 校验失败字段（契约 §1 的 401/400 分支）加错误描边。 */
		const INVALID_INPUT_STYLE = {
			...INPUT_BASE,
			border: "1px solid var(--dsw-alias-state-error-primary)"
		};
		const STATUS_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			minHeight: 20,
			fontSize: 13,
			lineHeight: "20px"
		};
		const ERROR_TEXT_STYLE = { color: "var(--dsw-alias-label-error)" };
		const SUCCESS_TEXT_STYLE = { color: "var(--dsw-alias-state-success-primary)" };
		const RULES_STYLE = {
			margin: 0,
			paddingLeft: 18,
			color: "var(--dsw-alias-label-error)"
		};
		const BUTTON_STYLE = {
			alignSelf: "flex-start",
			padding: "8px 20px",
			borderRadius: 10,
			border: "1px solid var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-inverted)",
			fontFamily: "inherit",
			fontSize: 14,
			fontWeight: 500,
			lineHeight: "22px",
			cursor: "pointer"
		};
		/** 提交中（双锁的可见态）：置灰但不移除，避免布局跳动。 */
		const BUTTON_BUSY_STYLE = {
			...BUTTON_STYLE,
			opacity: .6,
			cursor: "default"
		};
		/** 管理块根部：与上方自助改密区之间用一条分隔线 + 上间距，纵向排布。 */
		const ADMIN_BLOCK_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			marginTop: 4,
			paddingTop: 12,
			borderTop: "1px solid var(--dsw-alias-border-l2)"
		};
		/** 用户表：占满宽度、折叠边框；只做排版，不自绘视觉。 */
		const ADMIN_TABLE_STYLE = {
			width: "100%",
			borderCollapse: "collapse",
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary)"
		};
		const ADMIN_TH_STYLE = {
			textAlign: "left",
			padding: "6px 8px 6px 0",
			fontWeight: 500,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const ADMIN_TD_STYLE = {
			padding: "6px 8px 6px 0",
			borderTop: "1px solid var(--dsw-alias-border-l2)"
		};
		/** 只读徽标（角色 / 状态 / 两步验证 / 本人）：浅底 + 次级文字色，随主题切换。 */
		const ADMIN_BADGE_STYLE = {
			display: "inline-block",
			padding: "0 6px",
			borderRadius: 6,
			background: "var(--dsw-alias-bg-layer-2)",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 12,
			lineHeight: "18px"
		};
		//#endregion
		//#region src/client/account-fields.tsx
		/** 字段/节点 id 前缀（一个面板只有一个实例，静态 id 即可）。 */
		const PREFIX$1 = "dsh-auth-gate-account";
		/** 状态区 id：aria-live 播报位，也是错误字段 aria-describedby 的落点（成功态复用）。 */
		const ACCOUNT_STATUS_ID = `${PREFIX$1}-status`;
		/** 动态验证码输入提示 id。 */
		const CODE_HINT_ID = `${PREFIX$1}-code-hint`;
		/** 字段 id（label htmlFor / aria 关联复用）。 */
		function fieldId(name) {
			return `${PREFIX$1}-${name}`;
		}
		/** 带 label / 错误描边 / aria 关联的输入行。 */
		function Field({ id, name, label, type, autoComplete, value, invalid, onChange, hint, hintId, inputMode }) {
			const described = [invalid ? ACCOUNT_STATUS_ID : void 0, hintId].filter((item) => item !== void 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: LABEL_STYLE,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						htmlFor: id,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id,
						name,
						type,
						value,
						autoComplete,
						inputMode,
						"aria-invalid": invalid ? "true" : void 0,
						"aria-describedby": described.length === 0 ? void 0 : described.join(" "),
						style: invalid ? INVALID_INPUT_STYLE : INPUT_STYLE,
						onChange: (event) => onChange(event.target.value)
					}),
					hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: hintId,
						style: HINT_STYLE,
						children: hint
					})
				]
			});
		}
		/** 四字段（current / password / confirm / code），autocomplete 按语义固定。 */
		function PasswordFields({ t, values, isInvalid, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					id: fieldId("current"),
					name: "current",
					label: t(ACCOUNT_KEYS.current),
					type: "password",
					autoComplete: "current-password",
					value: values.current,
					invalid: isInvalid("current"),
					onChange: (value) => onChange("current", value)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					id: fieldId("password"),
					name: "password",
					label: t(ACCOUNT_KEYS.password),
					type: "password",
					autoComplete: "new-password",
					value: values.password,
					invalid: isInvalid("password"),
					onChange: (value) => onChange("password", value)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					id: fieldId("confirm"),
					name: "confirm",
					label: t(ACCOUNT_KEYS.confirm),
					type: "password",
					autoComplete: "new-password",
					value: values.confirm,
					invalid: isInvalid("confirm"),
					onChange: (value) => onChange("confirm", value)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					id: fieldId("code"),
					name: "code",
					label: t(ACCOUNT_KEYS.code),
					type: "text",
					inputMode: "numeric",
					autoComplete: "one-time-code",
					value: values.code,
					invalid: isInvalid("code"),
					hint: t(ACCOUNT_KEYS.codeHint),
					hintId: CODE_HINT_ID,
					onChange: (value) => onChange("code", value)
				})
			] });
		}
		/** 状态区：常驻 DOM 的 aria-live 播报位（idle 时留空，避免读屏漏播）。 */
		function StatusLine({ failure }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				id: ACCOUNT_STATUS_ID,
				role: "status",
				"aria-live": "polite",
				style: STATUS_STYLE,
				children: [failure === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: ERROR_TEXT_STYLE,
					children: failure.message
				}), failure === null || failure.rules.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					style: RULES_STYLE,
					children: failure.rules.map((rule) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: rule }, rule))
				})]
			});
		}
		//#endregion
		//#region src/client/account-submit.ts
		/** 自助改密端点（契约 §1：POST + application/x-www-form-urlencoded）。 */
		const PASSWORD_TARGET = "/auth/password";
		const EMPTY_VALUES = {
			current: "",
			password: "",
			confirm: "",
			code: ""
		};
		/** 客户端校验：两次新密码一致只在这里判（契约 §1：不进请求体）。值不 trim。 */
		function validate(values, t) {
			if (values.current === "") return {
				message: t(ACCOUNT_KEYS.currentRequired),
				rules: [],
				fields: ["current"]
			};
			if (values.password === "") return {
				message: t(ACCOUNT_KEYS.passwordRequired),
				rules: [],
				fields: ["password"]
			};
			if (values.password !== values.confirm) return {
				message: t(ACCOUNT_KEYS.mismatch),
				rules: [],
				fields: ["password", "confirm"]
			};
			return null;
		}
		/** 读失败体；解析失败返回空体，映射只看状态码。 */
		async function readFailureBody(res) {
			try {
				const body = await res.json();
				return typeof body === "object" && body !== null ? body : {};
			} catch {
				return {};
			}
		}
		/** 严格按契约 §1 响应矩阵映射，不自造错误码。 */
		function describeFailure(status, body, t) {
			if (status === 401) return body.error === "invalid_totp" ? {
				message: t(ACCOUNT_KEYS.invalidTotp),
				rules: [],
				fields: ["code"]
			} : {
				message: t(ACCOUNT_KEYS.invalidCredentials),
				rules: [],
				fields: ["current"]
			};
			if (status === 400 && body.error === "policy") {
				const rules = Array.isArray(body.rules) ? body.rules.filter((rule) => typeof rule === "string") : [];
				return {
					message: t(ACCOUNT_KEYS.policyIntro),
					rules: rules.map((rule) => ruleText(rule, t)),
					fields: ["password"]
				};
			}
			if (status === 429) return typeof body.retryAfter === "number" ? {
				message: t(ACCOUNT_KEYS.locked, { seconds: body.retryAfter }),
				rules: [],
				fields: []
			} : {
				message: t(ACCOUNT_KEYS.lockedPlain),
				rules: [],
				fields: []
			};
			if (status === 503) return {
				message: t(ACCOUNT_KEYS.unavailable),
				rules: [],
				fields: []
			};
			return {
				message: t(ACCOUNT_KEYS.generic),
				rules: [],
				fields: []
			};
		}
		/** 提交请求：URLSearchParams 原样编码；code 恒带上（TOTP 未开启时为空串）。 */
		function postPassword(values, signal) {
			const body = new URLSearchParams();
			body.set("current", values.current);
			body.set("password", values.password);
			body.set("code", values.code);
			return fetch(PASSWORD_TARGET, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body,
				signal,
				credentials: "same-origin"
			});
		}
		/** 发一次改密请求并按响应矩阵翻译；中途 abort 则立刻收手。 */
		async function submitPassword(values, signal, t) {
			const res = await postPassword(values, signal);
			if (signal.aborted) return { kind: "aborted" };
			if (res.ok) return { kind: "ok" };
			const body = await readFailureBody(res);
			if (signal.aborted) return { kind: "aborted" };
			return {
				kind: "failure",
				failure: describeFailure(res.status, body, t)
			};
		}
		//#endregion
		//#region src/client/account-form.tsx
		/**
		* 本插件自设计的图标（P1.1 / D24）：盾 + 钥匙孔，16px outline。
		*
		* 内容区标题行这一份是**我们自己的 React 树**：不依赖宿主任何内部结构，可测、可卸载。
		* 导航行那一份由 `account-nav-icon.ts` 的临时 DOM 垫片贴上去（宿主没有 `icon` 挂载点，
		* 见 D24.1）。两处共用 `account-icon.ts` 的路径数据，与 `docs/demo/account-security.svg` 同源。
		*/
		function AccountIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: ACCOUNT_ICON_VIEW_BOX,
				width: 16,
				height: 16,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				focusable: "false",
				children: ACCOUNT_ICON_PATHS.map((d) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d }, d))
			});
		}
		/**
		* 表单状态机：
		* - 双锁 = in-flight ref（硬锁，Enter/点击并发都挡）+ submitting 按钮 disabled（可见锁）；
		* - IME 组合期由 composing ref 挡住，避免中文输入法确认键提交；
		* - 请求带 AbortController，卸载即 abort，回调再看 mounted，绝不卸载后 setState。
		*/
		function usePasswordChange(t) {
			const [values, setValues] = (0, react.useState)(EMPTY_VALUES);
			const [submitting, setSubmitting] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(null);
			const [success, setSuccess] = (0, react.useState)(null);
			const lock = (0, react.useRef)(false);
			const composing = (0, react.useRef)(false);
			const abort = (0, react.useRef)(null);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
					abort.current?.abort();
				};
			}, []);
			const setValue = (field, value) => {
				setValues((previous) => ({
					...previous,
					[field]: value
				}));
			};
			const submit = async () => {
				if (lock.current) return;
				const invalid = validate(values, t);
				if (invalid !== null) {
					setFailure(invalid);
					return;
				}
				lock.current = true;
				setSubmitting(true);
				setFailure(null);
				const controller = new AbortController();
				abort.current = controller;
				const live = () => mounted.current && !controller.signal.aborted;
				try {
					const result = await submitPassword(values, controller.signal, t);
					if (!live()) return;
					if (result.kind === "ok") {
						setSuccess(t(ACCOUNT_KEYS.success));
						try {
							redirectToLogin();
						} catch {}
						return;
					}
					if (result.kind === "failure") setFailure(result.failure);
				} catch {
					if (!live()) return;
					setFailure({
						message: t(ACCOUNT_KEYS.generic),
						rules: [],
						fields: []
					});
				} finally {
					lock.current = false;
					if (mounted.current) setSubmitting(false);
				}
			};
			return {
				values,
				submitting,
				failure,
				success,
				composing,
				setValue,
				submit,
				relogin: redirectToLogin
			};
		}
		/** 已登录时的自助改密表单（成功后立即跳登录页；成功态面板只是兜底）。 */
		function AccountPasswordForm({ t }) {
			const form = usePasswordChange(t);
			const reloginButton = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (form.success !== null) reloginButton.current?.focus();
			}, [form.success]);
			const onSubmit = (event) => {
				event.preventDefault();
				if (form.composing.current) return;
				form.submit();
			};
			const onKeyDown = (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				if (form.composing.current || event.nativeEvent.isComposing) return;
				form.submit();
			};
			if (form.success !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: PANEL_STYLE,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", {
						style: TITLE_ROW_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountIcon, {}), t(ACCOUNT_KEYS.title)]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						id: ACCOUNT_STATUS_ID,
						role: "status",
						"aria-live": "polite",
						style: SUCCESS_TEXT_STYLE,
						children: form.success
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						ref: reloginButton,
						type: "button",
						onClick: form.relogin,
						style: BUTTON_STYLE,
						children: t(ACCOUNT_KEYS.relogin)
					})
				]
			});
			const isInvalid = (field) => form.failure?.fields.includes(field) === true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: PANEL_STYLE,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", {
						style: TITLE_ROW_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountIcon, {}), t(ACCOUNT_KEYS.title)]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(ACCOUNT_KEYS.intro)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(ACCOUNT_KEYS.scope)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						style: FORM_STYLE,
						noValidate: true,
						"aria-busy": form.submitting,
						onSubmit,
						onKeyDown,
						onCompositionStart: () => {
							form.composing.current = true;
						},
						onCompositionEnd: () => {
							form.composing.current = false;
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasswordFields, {
								t,
								values: form.values,
								isInvalid,
								onChange: form.setValue
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusLine, { failure: form.failure }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								disabled: form.submitting,
								style: form.submitting ? BUTTON_BUSY_STYLE : BUTTON_STYLE,
								children: form.submitting ? t(ACCOUNT_KEYS.submitting) : t(ACCOUNT_KEYS.submit)
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/admin-copy.ts
		/** 管理块词典键（集中常量，避免散落字符串）。 */
		const ADMIN_KEYS = {
			title: "admin.title",
			intro: "admin.intro",
			selfHint: "admin.selfHint",
			loading: "admin.loading",
			unavailable: "admin.unavailable",
			empty: "admin.empty",
			colUser: "admin.colUser",
			colRole: "admin.colRole",
			colState: "admin.colState",
			colTotp: "admin.colTotp",
			roleAdmin: "admin.roleAdmin",
			roleUser: "admin.roleUser",
			you: "admin.you",
			stateDisabled: "admin.stateDisabled",
			stateMustChange: "admin.stateMustChange",
			stateOk: "admin.stateOk",
			totpOn: "admin.totpOn",
			totpOff: "admin.totpOff",
			target: "admin.target",
			targetPlaceholder: "admin.targetPlaceholder",
			password: "admin.password",
			confirm: "admin.confirm",
			code: "admin.code",
			codeHint: "admin.codeHint",
			policyHint: "admin.policyHint",
			submit: "admin.submit",
			submitting: "admin.submitting",
			successRevoked: "admin.successRevoked",
			successKept: "admin.successKept",
			targetRequired: "admin.targetRequired",
			passwordRequired: "admin.passwordRequired",
			mismatch: "admin.mismatch",
			codeRequired: "admin.codeRequired",
			forbidden: "admin.forbidden",
			badTarget: "admin.badTarget",
			notFound: "admin.notFound",
			policyIntro: "admin.policyIntro",
			invalidTotp: "admin.invalidTotp",
			unauthorized: "admin.unauthorized",
			locked: "admin.locked",
			lockedPlain: "admin.lockedPlain",
			generic: "admin.generic"
		};
		/** 中文词典（键序与 §4 表一致，A4 的 2 键插在语义位置）。 */
		const ADMIN_DICT_ZH = {
			[ADMIN_KEYS.title]: "用户管理",
			[ADMIN_KEYS.intro]: "重置后，该用户下次登录会被要求立即改密；会话吊销若失败会单独提示。",
			[ADMIN_KEYS.selfHint]: "修改自己的密码请用上方表单。忘记自己的口令走 CLI `dsh-auth user passwd`（管理面不允许重置自己）。",
			[ADMIN_KEYS.loading]: "正在加载用户列表...",
			[ADMIN_KEYS.unavailable]: "用户列表暂时不可用，请稍后重试。",
			[ADMIN_KEYS.empty]: "没有可重置的其他用户。",
			[ADMIN_KEYS.colUser]: "用户",
			[ADMIN_KEYS.colRole]: "角色",
			[ADMIN_KEYS.colState]: "状态",
			[ADMIN_KEYS.colTotp]: "两步验证",
			[ADMIN_KEYS.roleAdmin]: "管理员",
			[ADMIN_KEYS.roleUser]: "用户",
			[ADMIN_KEYS.you]: "本人",
			[ADMIN_KEYS.stateDisabled]: "已禁用",
			[ADMIN_KEYS.stateMustChange]: "需改密",
			[ADMIN_KEYS.stateOk]: "正常",
			[ADMIN_KEYS.totpOn]: "已开启",
			[ADMIN_KEYS.totpOff]: "未开启",
			[ADMIN_KEYS.target]: "目标用户",
			[ADMIN_KEYS.targetPlaceholder]: "请选择用户",
			[ADMIN_KEYS.password]: "新密码",
			[ADMIN_KEYS.confirm]: "确认新密码",
			[ADMIN_KEYS.code]: "动态验证码",
			[ADMIN_KEYS.codeHint]: "你已开启两步验证，重置他人密码需填写动态码。",
			[ADMIN_KEYS.policyHint]: "新密码至少 14 个字符，且含大写字母、小写字母、数字和特殊字符。",
			[ADMIN_KEYS.submit]: "重置密码",
			[ADMIN_KEYS.submitting]: "提交中...",
			[ADMIN_KEYS.successRevoked]: "已重置，该用户的会话已全部吊销。",
			[ADMIN_KEYS.successKept]: "已重置，但该用户的现有会话仍然有效（吊销失败），请手动处理。",
			[ADMIN_KEYS.targetRequired]: "请选择目标用户。",
			[ADMIN_KEYS.passwordRequired]: "请输入新密码。",
			[ADMIN_KEYS.mismatch]: "两次输入的新密码不一致。",
			[ADMIN_KEYS.codeRequired]: "请输入动态验证码。",
			[ADMIN_KEYS.forbidden]: "没有权限执行此操作，或当前会话不允许。",
			[ADMIN_KEYS.badTarget]: "目标用户名不合法。",
			[ADMIN_KEYS.notFound]: "目标用户不存在。",
			[ADMIN_KEYS.policyIntro]: "新密码不符合以下要求：",
			[ADMIN_KEYS.invalidTotp]: "动态验证码不正确，或已被使用。",
			[ADMIN_KEYS.unauthorized]: "登录状态已失效，请重新登录。",
			[ADMIN_KEYS.locked]: "尝试次数过多，请在 {seconds} 秒后重试。",
			[ADMIN_KEYS.lockedPlain]: "尝试次数过多，请稍后重试。",
			[ADMIN_KEYS.generic]: "重置失败，请稍后重试。"
		};
		/** 英文词典（键序与中文一致）。 */
		const ADMIN_DICT_EN = {
			[ADMIN_KEYS.title]: "User management",
			[ADMIN_KEYS.intro]: "After a reset the user must change the password at the next sign-in; if revocation fails, that is reported separately.",
			[ADMIN_KEYS.selfHint]: "Use the form above to change your own password. If you forgot it, use the CLI `dsh-auth user passwd` (this panel cannot reset your own account).",
			[ADMIN_KEYS.loading]: "Loading users...",
			[ADMIN_KEYS.unavailable]: "The user list is temporarily unavailable. Please try again later.",
			[ADMIN_KEYS.empty]: "There are no other users to reset.",
			[ADMIN_KEYS.colUser]: "User",
			[ADMIN_KEYS.colRole]: "Role",
			[ADMIN_KEYS.colState]: "State",
			[ADMIN_KEYS.colTotp]: "Two-factor",
			[ADMIN_KEYS.roleAdmin]: "Admin",
			[ADMIN_KEYS.roleUser]: "User",
			[ADMIN_KEYS.you]: "You",
			[ADMIN_KEYS.stateDisabled]: "Disabled",
			[ADMIN_KEYS.stateMustChange]: "Must change",
			[ADMIN_KEYS.stateOk]: "Normal",
			[ADMIN_KEYS.totpOn]: "On",
			[ADMIN_KEYS.totpOff]: "Off",
			[ADMIN_KEYS.target]: "Target user",
			[ADMIN_KEYS.targetPlaceholder]: "Choose a user",
			[ADMIN_KEYS.password]: "New password",
			[ADMIN_KEYS.confirm]: "Confirm new password",
			[ADMIN_KEYS.code]: "Verification code",
			[ADMIN_KEYS.codeHint]: "Two-factor is on for your account, so resetting another user needs a code.",
			[ADMIN_KEYS.policyHint]: "At least 14 characters with an uppercase letter, a lowercase letter, a digit and a special character.",
			[ADMIN_KEYS.submit]: "Reset password",
			[ADMIN_KEYS.submitting]: "Submitting...",
			[ADMIN_KEYS.successRevoked]: "Reset done. All of that user's sessions were revoked.",
			[ADMIN_KEYS.successKept]: "Reset done, but that user's existing sessions are still valid (revocation failed); handle them manually.",
			[ADMIN_KEYS.targetRequired]: "Choose a target user.",
			[ADMIN_KEYS.passwordRequired]: "Enter a new password.",
			[ADMIN_KEYS.mismatch]: "The two new passwords do not match.",
			[ADMIN_KEYS.codeRequired]: "Enter the verification code.",
			[ADMIN_KEYS.forbidden]: "You are not allowed to do this, or this session is not allowed to.",
			[ADMIN_KEYS.badTarget]: "The target user name is invalid.",
			[ADMIN_KEYS.notFound]: "The target user does not exist.",
			[ADMIN_KEYS.policyIntro]: "The new password does not meet these requirements:",
			[ADMIN_KEYS.invalidTotp]: "The verification code is incorrect or already used.",
			[ADMIN_KEYS.unauthorized]: "Your session has expired. Please sign in again.",
			[ADMIN_KEYS.locked]: "Too many attempts. Try again in {seconds} seconds.",
			[ADMIN_KEYS.lockedPlain]: "Too many attempts. Try again later.",
			[ADMIN_KEYS.generic]: "Could not reset the password. Please try again later."
		};
		//#endregion
		//#region src/client/admin-failure.ts
		/**
		* 管理重置的失败映射（CONTRACT-pr2 §1.3 + §9/A10）。从 `admin-api.ts` 预拆出来（A12），
		* 避免单文件贴上限。**全函数**：只认下表的 (status, error) 字面量组合，
		* 其余一律 `admin.generic`，不自造错误码、不做前缀/子串匹配。
		*
		* 已核对 PR1：`self`（自助误走管理面）也回 `{error:"forbidden"}`，没有 `{error:"self"}`。
		*/
		function view(message, rules = [], fields = []) {
			return {
				message,
				rules,
				fields
			};
		}
		function isRecord$1(value) {
			return typeof value === "object" && value !== null;
		}
		/** 规则列表：只保留字符串项，未知规则名原样回显（复用 account 的 `ruleText`）。 */
		function ruleList(value) {
			return Array.isArray(value) ? value.filter((rule) => typeof rule === "string") : [];
		}
		/** 400：`bad_target` / `policy`（携带 rules）；其余（含缺 error）→ generic。 */
		function describeBadRequest(error, rules, t) {
			if (error === "policy") return view(t(ADMIN_KEYS.policyIntro), ruleList(rules).map((rule) => ruleText(rule, t)), ["password"]);
			if (error === "bad_target") return view(t(ADMIN_KEYS.badTarget), [], ["target"]);
			return view(t(ADMIN_KEYS.generic));
		}
		/** 401：`invalid_totp` / `unauthorized`；其余 → generic。 */
		function describeUnauthorized(error, t) {
			if (error === "invalid_totp") return view(t(ADMIN_KEYS.invalidTotp), [], ["code"]);
			if (error === "unauthorized") return view(t(ADMIN_KEYS.unauthorized));
			return view(t(ADMIN_KEYS.generic));
		}
		/** 429：`locked` + 数字 retryAfter 插值，缺数字用无参文案；其余 → generic。 */
		function describeLocked(error, retryAfter, t) {
			if (error !== "locked") return view(t(ADMIN_KEYS.generic));
			return typeof retryAfter === "number" ? view(t(ADMIN_KEYS.locked, { seconds: retryAfter })) : view(t(ADMIN_KEYS.lockedPlain));
		}
		/**
		* 状态码矩阵 → 文案键：
		* 400 bad_target / policy+rules、401 invalid_totp / unauthorized、403 forbidden、
		* 404 not_found、429 locked(+retryAfter)、其余（413/415/503 的 text/plain 与所有未列出组合，
		* 含缺 `error` 的 403/404/429）一律 generic。
		*/
		function describeAdminFailure(status, body, t) {
			const record = isRecord$1(body) ? body : {};
			const error = record["error"];
			if (status === 400) return describeBadRequest(error, record["rules"], t);
			if (status === 401) return describeUnauthorized(error, t);
			if (status === 403 && error === "forbidden") return view(t(ADMIN_KEYS.forbidden));
			if (status === 404 && error === "not_found") return view(t(ADMIN_KEYS.notFound), [], ["target"]);
			if (status === 429) return describeLocked(error, record["retryAfter"], t);
			return view(t(ADMIN_KEYS.generic));
		}
		//#endregion
		//#region src/client/admin-api.ts
		const USERS_TARGET = "/auth/users";
		const RESET_TARGET = "/auth/users/password";
		function isRecord(value) {
			return typeof value === "object" && value !== null;
		}
		/** 单行形状校验：任一必需字段类型不符即丢弃该行（不整表失败，契约 §1.2）。 */
		function asRow(value) {
			if (!isRecord(value)) return void 0;
			const name = value["name"];
			const role = value["role"];
			const disabled = value["disabled"];
			const totpEnabled = value["totpEnabled"];
			const mustChangePassword = value["mustChangePassword"];
			if (typeof name !== "string" || name === "") return void 0;
			if (role !== "admin" && role !== "user") return void 0;
			if (typeof disabled !== "boolean" || typeof totpEnabled !== "boolean") return void 0;
			if (typeof mustChangePassword !== "boolean") return void 0;
			return {
				name,
				role,
				disabled,
				totpEnabled,
				mustChangePassword
			};
		}
		/** 解析 200 body；`users` 不是数组视为形状非法（整表 failure）。 */
		function parseUsers(body) {
			if (!isRecord(body)) return void 0;
			const raw = body["users"];
			if (!Array.isArray(raw)) return void 0;
			return raw.map(asRow).filter((row) => row !== void 0);
		}
		/** 读 JSON；非对象或解析失败统一回空体（映射只看状态码）。 */
		async function readJsonSafe(res) {
			try {
				const body = await res.json();
				return isRecord(body) ? body : {};
			} catch {
				return {};
			}
		}
		/**
		* `GET /auth/users`（cookie only，无 Origin 要求）。
		* 403 → `denied`（静默降级）；401 → `unauthorized`（整页登录态已死，必须提示，§9/A2）；
		* 非 200 / 形状非法 / 网络抛错 → `failure`；中止 → `aborted`（abort 后不解析响应体）。
		*/
		async function fetchAdminUsers(signal) {
			try {
				const res = await fetch(USERS_TARGET, {
					method: "GET",
					signal,
					credentials: "same-origin"
				});
				if (signal.aborted) return { kind: "aborted" };
				if (res.status === 403) return { kind: "denied" };
				if (res.status === 401) return { kind: "unauthorized" };
				if (!res.ok) return { kind: "failure" };
				const body = await res.json();
				if (signal.aborted) return { kind: "aborted" };
				const users = parseUsers(body);
				return users === void 0 ? { kind: "failure" } : {
					kind: "ok",
					users
				};
			} catch {
				return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
			}
		}
		/**
		* 本地校验闭表（§9/A6）：target → password → confirm → code。
		* `code` 只在 `actorTotpEnabled === true` 时校验，且用 `trim()` 判空（口令字段不 trim）。
		* 第三个参数缺省 false，只传两个实参的调用方行为不变。
		*/
		function validateAdminReset(values, t, actorTotpEnabled = false) {
			if (values.target === "") return {
				message: t(ADMIN_KEYS.targetRequired),
				rules: [],
				fields: ["target"]
			};
			if (values.password === "") return {
				message: t(ADMIN_KEYS.passwordRequired),
				rules: [],
				fields: ["password"]
			};
			if (values.password !== values.confirm) return {
				message: t(ADMIN_KEYS.mismatch),
				rules: [],
				fields: ["password", "confirm"]
			};
			if (actorTotpEnabled && values.code.trim() === "") return {
				message: t(ADMIN_KEYS.codeRequired),
				rules: [],
				fields: ["code"]
			};
			return null;
		}
		/**
		* 提交请求体（§9/A3）：只发 `target` / `password`，`actorTotpEnabled === true` 时才带 `code`
		* （缺码场景不发空串）；**`confirm` 永不发送**。
		*/
		function postAdminReset(values, options) {
			const body = new URLSearchParams();
			body.set("target", values.target);
			body.set("password", values.password);
			if (options.actorTotpEnabled) body.set("code", values.code);
			return fetch(RESET_TARGET, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body,
				signal: options.signal,
				credentials: "same-origin"
			});
		}
		/**
		* `POST /auth/users/password`：
		* **成功只认契约 §1.3 的唯一形状** `200 {ok:true}`（grok 实现期必修 1）：2xx 但缺 `ok:true`
		* （空 JSON、`{ok:false}`、中间层 HTML 拦截页）一律走失败映射，宁可报错也不谎报"已重置"
		* 再清空现场口令。`sessionsRevoked` 缺失/非布尔/解析失败按 `false`（§9/A8+A10）；
		* 中止 → `aborted`。
		*/
		async function submitAdminReset(values, options, t) {
			try {
				const res = await postAdminReset(values, options);
				if (options.signal.aborted) return { kind: "aborted" };
				const body = await readJsonSafe(res);
				if (options.signal.aborted) return { kind: "aborted" };
				if (res.status === 200 && body["ok"] === true) return {
					kind: "ok",
					sessionsRevoked: body["sessionsRevoked"] === true
				};
				return {
					kind: "failure",
					failure: describeAdminFailure(res.status, body, t)
				};
			} catch {
				if (options.signal.aborted) return { kind: "aborted" };
				return {
					kind: "failure",
					failure: {
						message: t(ADMIN_KEYS.generic),
						rules: [],
						fields: []
					}
				};
			}
		}
		//#endregion
		//#region src/client/admin-fields.tsx
		/**
		* 管理块的共享展示件（lead 批的 A12 预拆）：id 常量 + 输入行 + 状态播报位。
		* 只被 `admin-form.tsx` / `admin-block.tsx` **单向** import；本文件不 import 它们（避免循环）。
		*/
		/** id 前缀冻结（契约 §3.10）：一个面板只有一个管理块实例，静态 id 即可。 */
		const PREFIX = "dsh-auth-gate-admin";
		/** 状态播报位：aria-live 落点，也是错误字段 aria-describedby 的目标。 */
		const ADMIN_STATUS_ID = `${PREFIX}-status`;
		const ADMIN_CODE_HINT_ID = `${PREFIX}-code-hint`;
		function adminFieldId(field) {
			return `${PREFIX}-${field}`;
		}
		/** 带 label / 错误描边 / aria 关联的输入行（与自助面同范式，id 换管理块前缀）。 */
		function AdminTextField({ field, label, value, invalid, onChange, hint, hintId }) {
			const described = [invalid ? ADMIN_STATUS_ID : void 0, hintId].filter((item) => item !== void 0);
			const id = adminFieldId(field);
			const isCode = field === "code";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: LABEL_STYLE,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						htmlFor: id,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id,
						name: field,
						type: isCode ? "text" : "password",
						value,
						autoComplete: isCode ? "one-time-code" : "new-password",
						inputMode: isCode ? "numeric" : void 0,
						"aria-invalid": invalid ? "true" : void 0,
						"aria-describedby": described.length === 0 ? void 0 : described.join(" "),
						style: invalid ? INVALID_INPUT_STYLE : INPUT_STYLE,
						onChange: (event) => onChange(event.target.value)
					}),
					hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: hintId,
						style: HINT_STYLE,
						children: hint
					})
				]
			});
		}
		/** 状态区：失败消息 + 已翻译规则列表 + 就地成功/警告文案（契约 §3.8 / A8）。 */
		function AdminStatus({ failure, success }) {
			const warning = success?.warning === true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				id: ADMIN_STATUS_ID,
				role: "status",
				"aria-live": "polite",
				style: STATUS_STYLE,
				children: [
					failure === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: ERROR_TEXT_STYLE,
						children: failure.message
					}),
					failure === null || failure.rules.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: RULES_STYLE,
						children: failure.rules.map((rule) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: rule }, rule))
					}),
					success === null || warning ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: SUCCESS_TEXT_STYLE,
						children: success.text
					})
				]
			}), warning && success !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "alert",
				"aria-live": "assertive",
				style: ERROR_TEXT_STYLE,
				children: success.text
			}) : null] });
		}
		//#endregion
		//#region src/client/admin-types.ts
		/** 表单初值：提交成功后必须清回这一份（契约 §3.8）。 */
		const EMPTY_ADMIN_RESET = {
			target: "",
			password: "",
			confirm: "",
			code: ""
		};
		//#endregion
		//#region src/client/admin-form.tsx
		/**
		* 表单状态机（与自助面同范式）：
		* - 双锁 = in-flight ref（硬锁，Enter/点击并发都挡）+ submitting 按钮 disabled（可见锁）；
		* - IME 组合期由 composing ref 挡住，避免中文输入法确认键提交；
		* - 请求带 AbortController，卸载即 abort，回调再看 mounted，绝不卸载后 setState；
		* - 成功：落成功文案（`sessionsRevoked:false` 走 A8 的安全失败样式），清空四字段，再重拉列表。
		*/
		/** 表单事件：IME 组合期（Enter 确认键）一律不提交；并发双锁由 `submit` 自己兜底。 */
		function formHandlers(composing, submit) {
			return {
				onCompositionStart: () => {
					composing.current = true;
				},
				onCompositionEnd: () => {
					composing.current = false;
				},
				onSubmit: (event) => {
					event.preventDefault();
					if (composing.current) return;
					submit();
				},
				onKeyDown: (event) => {
					if (event.key !== "Enter") return;
					if (event.target instanceof HTMLSelectElement) return;
					event.preventDefault();
					if (composing.current || event.nativeEvent.isComposing) return;
					submit();
				}
			};
		}
		/** 成功视图（A8）：`sessionsRevoked:false` 是安全失败，文案与样式都换一套。 */
		function successView(sessionsRevoked, t) {
			return sessionsRevoked ? {
				text: t(ADMIN_KEYS.successRevoked),
				warning: false
			} : {
				text: t(ADMIN_KEYS.successKept),
				warning: true
			};
		}
		function useAdminReset(t, actorTotpEnabled, onReset) {
			const [values, setValues] = (0, react.useState)(EMPTY_ADMIN_RESET);
			const [submitting, setSubmitting] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(null);
			const [success, setSuccess] = (0, react.useState)(null);
			const lock = (0, react.useRef)(false);
			const composing = (0, react.useRef)(false);
			const abort = (0, react.useRef)(null);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
					abort.current?.abort();
				};
			}, []);
			const setValue = (field, value) => {
				setValues((previous) => ({
					...previous,
					[field]: value
				}));
			};
			const submit = async () => {
				if (lock.current) return;
				const invalid = validateAdminReset(values, t, actorTotpEnabled);
				if (invalid !== null) {
					setFailure(invalid);
					return;
				}
				lock.current = true;
				setSubmitting(true);
				setFailure(null);
				setSuccess(null);
				const controller = new AbortController();
				abort.current = controller;
				const live = () => mounted.current && !controller.signal.aborted;
				try {
					const result = await submitAdminReset(values, {
						signal: controller.signal,
						actorTotpEnabled
					}, t);
					if (!live()) return;
					if (result.kind === "ok") {
						setSuccess(successView(result.sessionsRevoked, t));
						setValues({ ...EMPTY_ADMIN_RESET });
						onReset?.();
						return;
					}
					if (result.kind === "failure") setFailure(result.failure);
				} catch {
					if (!live()) return;
					setFailure({
						message: t(ADMIN_KEYS.generic),
						rules: [],
						fields: []
					});
				} finally {
					lock.current = false;
					if (mounted.current) setSubmitting(false);
				}
			};
			return {
				values,
				submitting,
				failure,
				success,
				setValue,
				...formHandlers(composing, submit)
			};
		}
		/** 管理重置表单：目标下拉（排除本人）+ 新口令 ×2 + 条件式动态码；成功后清空四字段、不跳转。 */
		function AdminResetForm({ t, users, actorName, actorTotpEnabled, onReset }) {
			const form = useAdminReset(t, actorTotpEnabled, onReset);
			const targets = users.filter((user) => user.name !== actorName);
			const fields = [
				{
					field: "password",
					label: t(ADMIN_KEYS.password)
				},
				{
					field: "confirm",
					label: t(ADMIN_KEYS.confirm)
				},
				...actorTotpEnabled ? [{
					field: "code",
					label: t(ADMIN_KEYS.code)
				}] : []
			];
			const isInvalid = (field) => form.failure?.fields.includes(field) === true;
			const targetInvalid = isInvalid("target");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				style: FORM_STYLE,
				noValidate: true,
				"aria-busy": form.submitting,
				onSubmit: form.onSubmit,
				onKeyDown: form.onKeyDown,
				onCompositionStart: form.onCompositionStart,
				onCompositionEnd: form.onCompositionEnd,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(ADMIN_KEYS.selfHint)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: LABEL_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: adminFieldId("target"),
							children: t(ADMIN_KEYS.target)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							id: adminFieldId("target"),
							name: "target",
							value: form.values.target,
							"aria-invalid": targetInvalid ? "true" : void 0,
							"aria-describedby": targetInvalid ? ADMIN_STATUS_ID : void 0,
							style: targetInvalid ? INVALID_INPUT_STYLE : INPUT_STYLE,
							onChange: (event) => form.setValue("target", event.target.value),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: t(ADMIN_KEYS.targetPlaceholder)
							}), targets.map((user) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: user.name,
								children: user.name
							}, user.name))]
						})]
					}),
					fields.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminTextField, {
						field: item.field,
						label: item.label,
						value: form.values[item.field],
						invalid: isInvalid(item.field),
						hint: item.field === "code" ? t(ADMIN_KEYS.codeHint) : void 0,
						hintId: item.field === "code" ? ADMIN_CODE_HINT_ID : void 0,
						onChange: (value) => form.setValue(item.field, value)
					}, item.field)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(ADMIN_KEYS.policyHint)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminStatus, {
						failure: form.failure,
						success: form.success
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "submit",
						disabled: form.submitting,
						style: form.submitting ? BUTTON_BUSY_STYLE : BUTTON_STYLE,
						children: form.submitting ? t(ADMIN_KEYS.submitting) : t(ADMIN_KEYS.submit)
					})
				]
			});
		}
		//#endregion
		//#region src/client/admin-block.tsx
		const TITLE_ID = "dsh-auth-gate-admin-title";
		/**
		* 挂载后拉一次列表（契约 §3.4：非 admin 根本不会挂载本组件，这里不判断角色）；
		* `reload` 供 A7 成功后静默刷新徽标：刷新失败**不改行**（首拉才降级），同一 abort 规则。
		*/
		function useAdminUsers() {
			const [state, setState] = (0, react.useState)({ kind: "loading" });
			const [attempt, setAttempt] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let live = true;
				const first = attempt === 0;
				fetchAdminUsers(controller.signal).then((result) => {
					if (!live || result.kind === "aborted") return;
					if (result.kind === "ok") setState({
						kind: "ok",
						users: result.users
					});
					else if (first) setState({ kind: result.kind });
				}).catch(() => {
					if (live && first) setState({ kind: "failure" });
				});
				return () => {
					live = false;
					controller.abort();
				};
			}, [attempt]);
			return {
				state,
				reload: () => setAttempt((value) => value + 1)
			};
		}
		/** 角色文案：`admin`/`user` 走词典；**未知取值原样渲染**，不新增键（A9）。 */
		function roleText(role, t) {
			if (role === "admin") return t(ADMIN_KEYS.roleAdmin);
			if (role === "user") return t(ADMIN_KEYS.roleUser);
			return String(role);
		}
		/** 状态徽标**互斥**，优先级 disabled > mustChangePassword > ok（A9）。 */
		function stateText(user, t) {
			if (user.disabled) return t(ADMIN_KEYS.stateDisabled);
			return user.mustChangePassword ? t(ADMIN_KEYS.stateMustChange) : t(ADMIN_KEYS.stateOk);
		}
		/** 只读用户表：**保持服务端顺序**，不做任何重排（契约 §1.2 / §3.5）。 */
		function AdminUsersTable({ t, users, actorName }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
				style: ADMIN_TABLE_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
						style: ADMIN_TH_STYLE,
						children: t(ADMIN_KEYS.colUser)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
						style: ADMIN_TH_STYLE,
						children: t(ADMIN_KEYS.colRole)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
						style: ADMIN_TH_STYLE,
						children: t(ADMIN_KEYS.colState)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
						style: ADMIN_TH_STYLE,
						children: t(ADMIN_KEYS.colTotp)
					})
				] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: users.map((user) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
						style: ADMIN_TD_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: user.name }), user.name === actorName ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: ADMIN_BADGE_STYLE,
							children: t(ADMIN_KEYS.you)
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
						style: ADMIN_TD_STYLE,
						children: roleText(user.role, t)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
						style: ADMIN_TD_STYLE,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: ADMIN_BADGE_STYLE,
							children: stateText(user, t)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
						style: ADMIN_TD_STYLE,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: ADMIN_BADGE_STYLE,
							children: user.totpEnabled ? t(ADMIN_KEYS.totpOn) : t(ADMIN_KEYS.totpOff)
						})
					})
				] }, user.name)) })]
			});
		}
		/** 提示态（loading / unauthorized / unavailable）：同一条 aria-live 播报位。 */
		function AdminNotice({ text, error }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				id: ADMIN_STATUS_ID,
				role: "status",
				"aria-live": "polite",
				style: error === true ? ERROR_TEXT_STYLE : HINT_STYLE,
				children: text
			});
		}
		/**
		* 管理块（契约 §3 / A2）：loading → denied 静默 null → unauthorized / failure 提示
		* → ok 列表 + 表单。「只有本人」时显示 `admin.empty` 且**不渲染表单**（§3.6）。
		*/
		function AdminUsersBlock({ t, actorName, actorTotpEnabled }) {
			const { state, reload } = useAdminUsers();
			if (state.kind === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminNotice, { text: t(ADMIN_KEYS.loading) });
			if (state.kind === "denied") return null;
			if (state.kind === "unauthorized") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminNotice, {
				text: t(ADMIN_KEYS.unauthorized),
				error: true
			});
			if (state.kind === "failure") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminNotice, {
				text: t(ADMIN_KEYS.unavailable),
				error: true
			});
			const targets = state.users.filter((user) => user.name !== actorName);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: ADMIN_BLOCK_STYLE,
				"aria-labelledby": TITLE_ID,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						id: TITLE_ID,
						style: TITLE_STYLE,
						children: t(ADMIN_KEYS.title)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(ADMIN_KEYS.intro)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminUsersTable, {
						t,
						users: state.users,
						actorName
					}),
					targets.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						id: ADMIN_STATUS_ID,
						style: HINT_STYLE,
						children: t(ADMIN_KEYS.empty)
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminResetForm, {
						t,
						users: state.users,
						actorName,
						actorTotpEnabled,
						onReset: reload
					})
				]
			});
		}
		//#endregion
		//#region src/client/account-status.ts
		/** 会话探针（只认 cookie，语义同 `/auth/status`，契约 §1.1）。 */
		const STATUS_TARGET = "/auth/status";
		/** 字符串字段守卫：非字符串一律 `undefined`（旧服务端/异常形状都不渲染管理块）。 */
		function optionalString(value) {
			return typeof value === "string" ? value : void 0;
		}
		/** 布尔字段守卫。 */
		function optionalBoolean(value) {
			return typeof value === "boolean" ? value : void 0;
		}
		/** role 白名单：只认 `admin` / `user`，其余（含非法字符串）留 `undefined`。 */
		function optionalRole(value) {
			return value === "admin" || value === "user" ? value : void 0;
		}
		/** sessionKind 白名单：只认 `full` / `password-change-only`。 */
		function optionalSessionKind(value) {
			return value === "full" || value === "password-change-only" ? value : void 0;
		}
		/**
		* `/auth/status` 响应体 → 视图对象。**加法兼容**（契约 §1.1/§3.3）：
		* 身份字段缺失、类型不符或取值不在白名单内，一律留 `undefined`；只有
		* `authenticated === true` 才可能让调用方继续渲染登录后的 UI。
		*/
		function parseAccountStatus(body) {
			const source = typeof body === "object" && body !== null ? body : {};
			return {
				authenticated: source["authenticated"] === true,
				name: optionalString(source["name"]),
				role: optionalRole(source["role"]),
				disabled: optionalBoolean(source["disabled"]),
				totpEnabled: optionalBoolean(source["totpEnabled"]),
				sessionKind: optionalSessionKind(source["sessionKind"])
			};
		}
		/**
		* 会话状态探针：`null` = 首次响应返回前（调用方自己渲染 loading）。
		* `credentials: "same-origin"` 保证带 cookie；卸载即 abort，回调里再看一眼 signal，
		* 避免卸载后 setState。任何失败（网络/解析/中止之外的异常）→ `{authenticated:false}`。
		*/
		function useAccountStatus() {
			const [status, setStatus] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				fetch(STATUS_TARGET, {
					signal: controller.signal,
					credentials: "same-origin"
				}).then((res) => res.json()).then((body) => {
					if (!controller.signal.aborted) setStatus(parseAccountStatus(body));
				}).catch(() => {
					if (!controller.signal.aborted) setStatus({ authenticated: false });
				});
				return () => {
					controller.abort();
				};
			}, []);
			return status;
		}
		//#endregion
		//#region src/client/account-section.tsx
		/** 提示态 id：loading / 未登录共用一个 aria-live 播报位。 */
		const NOTICE_ID = "dsh-auth-gate-account-notice";
		/** 无表单的提示态（loading / 请先登录），保留 aria-live 播报。 */
		function Notice({ text }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				style: PANEL_STYLE,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					id: NOTICE_ID,
					role: "status",
					"aria-live": "polite",
					style: HINT_STYLE,
					children: text
				})
			});
		}
		/**
		* 管理块渲染门（契约 §9-A1，四条**同时**成立才渲染）：`role === "admin"`、
		* `disabled === false`、`sessionKind === "full"`、`name` 是字符串。
		* **不做 `?? "full"` 兜底**：任一字段缺失或非该值 = 不渲染且零管理请求
		* （旧服务端/部分字段与「非 admin 不试拉」加法兼容；禁用 admin 不挂块）。
		*/
		function showsAdminBlock(status) {
			return status.role === "admin" && status.disabled === false && status.sessionKind === "full" && typeof status.name === "string";
		}
		/**
		* 「账户」设置页（`settings.section`）：未登录不给表单；已登录渲染自助改密表单，
		* 并在身份满足渲染门时（admin + 正式会话）追加管理块。`t` 缺失时降级到英文词典
		* （不显示键名），由 account-form / admin-block 承担各自的提交逻辑。
		*/
		function SettingsAccountSection({ t }) {
			const status = useAccountStatus();
			const translate = typeof t === "function" ? t : translateFrom({
				...ACCOUNT_DICT_EN,
				...ADMIN_DICT_EN
			});
			if (status === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Notice, { text: translate(ACCOUNT_KEYS.loading) });
			if (status.authenticated !== true) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Notice, { text: translate(ACCOUNT_KEYS.loginRequired) });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountPasswordForm, { t: translate }), showsAdminBlock(status) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminUsersBlock, {
				t: translate,
				actorName: status.name,
				actorTotpEnabled: status.totpEnabled !== false
			}) : null] });
		}
		//#endregion
		//#region src/client/logout-action.tsx
		/** 登出目标：POST-only（M22：next 仅从 query 取，校验回落 /）。 */
		const LOGOUT_TARGET = "/auth/logout?next=/";
		/**
		* 登出图标：16px 按钮图标（viewBox 24 不变，只设 width/height 16）。
		* 沿用原 32px 圆形按钮的同一个 SVG（方框 + 箭头）。
		*/
		function renderLogoutIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 24 24",
				width: 16,
				height: 16,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "16 17 21 12 16 7" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "21",
						y1: "12",
						x2: "9",
						y2: "12"
					})
				]
			});
		}
		/**
		* 设置面板内醒目的登出 CTA：错误强调色（危险动作语义）填充按钮 +
		* 反色标签 `--dsw-alias-label-primary-inverted`，面板内水平居中（General 页底部）。
		*/
		const CTA_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: 8,
			padding: "10px 24px",
			borderRadius: 12,
			border: "1px solid var(--dsw-alias-state-error-primary)",
			background: "var(--dsw-alias-state-error-primary)",
			color: "var(--dsw-alias-label-primary-inverted)",
			fontFamily: "inherit",
			fontSize: 14,
			fontWeight: 500,
			lineHeight: "22px",
			cursor: "pointer"
		};
		/** hover 态轻微提亮（随主题自适应，不硬编码色值）。 */
		const CTA_HOVER_FILTER = "brightness(1.08)";
		/** 面板内水平居中容器（General 页最后一条行之后）。 */
		const CTA_WRAP_STYLE = {
			display: "flex",
			justifyContent: "center",
			padding: "20px 0 4px"
		};
		const formStyle = { display: "contents" };
		/**
		* 会话状态门控：挂载时 fetch /auth/status 一次（只认 cookie）。
		* @returns authenticated：null = 未知（第一次请求前），true/false。
		*/
		function useAuthenticated() {
			const [authenticated, setAuthenticated] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let cancelled = false;
				fetch("/auth/status").then((res) => res.json()).then((body) => {
					if (!cancelled) setAuthenticated(body.authenticated === true);
				}).catch(() => {
					if (!cancelled) setAuthenticated(false);
				});
				return () => {
					cancelled = true;
				};
			}, []);
			return authenticated;
		}
		/**
		* 可复用的登出提交按钮：原生 form POST（零 JS 依赖）+ 16px 方块图标 + 本地化文字。
		* 渲染进 `settings.general.item`（设置 → 通用设置 的追加行槽，order 30 → 页面底部），
		* 水平居中的醒目 CTA；文案随界面语言在「退出登录」/ "Sign out" 间切换。
		*/
		function SettingsLogoutAction({ t }) {
			const authenticated = useAuthenticated();
			const [hovered, setHovered] = (0, react.useState)(false);
			if (authenticated !== true) return null;
			const label = typeof t === "function" ? t("logout") : "Sign out";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("form", {
				method: "post",
				action: LOGOUT_TARGET,
				style: formStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: CTA_WRAP_STYLE,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "submit",
						"aria-label": label,
						title: label,
						style: {
							...CTA_STYLE,
							filter: hovered ? CTA_HOVER_FILTER : void 0
						},
						onMouseEnter: () => setHovered(true),
						onMouseLeave: () => setHovered(false),
						children: [renderLogoutIcon(), label]
					})
				})
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** 本插件文案的词典命名域（locale 服务按 (ns, locale) 分开注册）。 */
		const AUTH_NS = "auth";
		/** 命名词典里登出键。 */
		const LOGOUT_KEY = "logout";
		/** 「账号安全」设置页（自助改密）的 section id。 */
		const ACCOUNT_SECTION_ID = "dsh-auth-gate-account";
		/**
		* 「账号安全」页在设置导航里的排列位置。
		*
		* 已知占用：宿主 general 0 / models 10 / plugins 15 / agent-presets 20（0.1.7 起还有官方云账户
		* `account` -10），姊妹包 dsh-plugin-subscriptions 的订阅页 90，全部远小于 900，所以 900
		* 表示「大于已知的全部条目、落在导航靠后」（账号安全压轴是设置页惯例，宿主 nav 列也没有滚动条）。
		*
		* **不保证全局最后**：宿主只按 order 升序排、没有并列决胜（同值按插件注册顺序，跨安装不稳定），
		* 后来者随时可能注册更大或相同的值。谁先到谁先用 900，撞车时按 901/902 递增（ADR D24 已记录）。
		*/
		const ACCOUNT_SECTION_ORDER = 900;
		/**
		* 默认槽位 order：注册时先用它（与 host 端 Config 默认一致），随后 `/auth/status`
		* 探针读到 host 配置的 `logoutOrder` 时按配置重注册。1000 已大于 dsh 自带条目
		* （agent-preset -25 / permission -20 / language 0 / appearance 10 / composer-enter 20），
		* 除非第三方插件注册更大的 order，按钮始终留在通用设置页最底部。
		*/
		const DEFAULT_LOGOUT_ORDER = 1e3;
		/**
		* dsh-auth-gate client 半边：认证后在**设置面板**（设置 → 通用设置 页底部）挂一
		* 个醒目的「退出登录 / Sign out」按钮：`settings.general.item`（root 作用域、
		* 可追加列表槽，由 ui-settings-general 的 General 页堆叠渲染，按 order 升序）。
		*
		* 顺序可配置：先以默认 order（1000）注册（探针失败/未开始前按钮也可见），再探
		* `/auth/status` 读取 host 配置的 `logoutOrder`，与默认不同则按配置值重注册
		* （同 id 注册 = 槽位替换，先注册新条目再释放旧条目，避免中间态空白）。
		*
		* 换槽对比：不再往会话页 `conversation.session.header.utilities`、新会话页
		* `shell.overlay` 注册（右上角两处入口已移除），也不占侧边栏 footer 脚区。
		* 文案挂进 dsh 现有的 locale 机制（与「设置」里的语言切换同一套）：注册 `auth`
		* 词典（zh/en），再以 `locale: "auth"` 给注册条目注入 `t` seat，按钮文字随界面
		* 语言在「退出登录」/ "Sign out" 间实时切换。不改任何服务端端点/会话语义。
		*
		* 同一次 apply 还注册「账号安全」设置页（`settings.section`，id
		* dsh-auth-gate-account，order 900）：内容为自助改密表单（见 account-section.tsx），
		* 文案复用同一个 `auth` 词典的 account 键。登出按钮的注册逻辑与 order 语义不变。
		*
		* 导航行图标（D24.1）：宿主 `settings.section` 没有 `icon` 选项（只有 id/order/label），
		* 第三方段的图标恒为宿主默认齿轮；插件侧没有官方挂载点，所以 `account-nav-icon.ts` 只对
		* 我们这一行做一次临时 DOM 垫片（自设计盾牌图标），上游支持 `icon` 后整体删除。
		*/
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => [ctx.locale.register(AUTH_NS, "zh", {
				[LOGOUT_KEY]: "退出登录",
				...ACCOUNT_DICT_ZH,
				...ADMIN_DICT_ZH
			}), ctx.locale.register(AUTH_NS, "en", {
				[LOGOUT_KEY]: "Sign out",
				...ACCOUNT_DICT_EN,
				...ADMIN_DICT_EN
			})], "auth: zh/en dictionaries (logout + account + admin)");
			const t = ctx.locale.bind(AUTH_NS);
			ctx.slots.inject("settings.general.item", () => {
				const mount = (order) => ctx.slots.register({
					name: "settings.general.item",
					id: "dsh-auth-gate-logout",
					locale: AUTH_NS,
					order,
					label: () => t(LOGOUT_KEY)
				}, SettingsLogoutAction);
				let dispose = mount(DEFAULT_LOGOUT_ORDER);
				try {
					fetch("/auth/status").then((res) => res.json()).then((body) => {
						const order = body.logoutOrder;
						if (typeof order !== "number" || !Number.isInteger(order) || order === DEFAULT_LOGOUT_ORDER) return;
						const previous = dispose;
						dispose = mount(order);
						previous?.();
					}).catch(() => void 0);
				} catch {}
				return () => dispose?.();
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: ACCOUNT_SECTION_ID,
				locale: AUTH_NS,
				order: ACCOUNT_SECTION_ORDER,
				label: () => t(ACCOUNT_KEYS.nav)
			}, SettingsAccountSection));
			ctx.effect(() => installAccountNavIcon(globalThis.document), "auth: account nav icon shim (D24.1)");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map