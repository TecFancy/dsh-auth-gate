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
		/** 标题行（P1.1）：自带图标 + 文案横排，图标随文字色（currentColor）跟随主题。 */
		const TITLE_ROW_STYLE = {
			margin: 0,
			fontSize: 16,
			fontWeight: 600,
			lineHeight: "24px",
			color: "var(--dsw-alias-label-primary)",
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
		//#endregion
		//#region src/client/account-fields.tsx
		/** 字段/节点 id 前缀（一个面板只有一个实例，静态 id 即可）。 */
		const PREFIX = "dsh-auth-gate-account";
		/** 状态区 id：aria-live 播报位，也是错误字段 aria-describedby 的落点（成功态复用）。 */
		const ACCOUNT_STATUS_ID = `${PREFIX}-status`;
		/** 动态验证码输入提示 id。 */
		const CODE_HINT_ID = `${PREFIX}-code-hint`;
		/** 字段 id（label htmlFor / aria 关联复用）。 */
		function fieldId(name) {
			return `${PREFIX}-${name}`;
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
		//#region src/client/account-section.tsx
		/** 会话探针（只认 cookie，语义同 `/auth/status`）。 */
		const STATUS_TARGET = "/auth/status";
		/** 提示态 id：loading / 未登录共用一个 aria-live 播报位。 */
		const NOTICE_ID = "dsh-auth-gate-account-notice";
		/**
		* 会话状态：null = 第一次请求返回前（组件自己处理 loading），true/false = 已确认。
		* 卸载即 abort，回调里再看一眼 signal，避免卸载后 setState。
		*/
		function useSessionStatus() {
			const [authenticated, setAuthenticated] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				fetch(STATUS_TARGET, {
					signal: controller.signal,
					credentials: "same-origin"
				}).then((res) => res.json()).then((body) => {
					if (!controller.signal.aborted) setAuthenticated(body.authenticated === true);
				}).catch(() => {
					if (!controller.signal.aborted) setAuthenticated(false);
				});
				return () => {
					controller.abort();
				};
			}, []);
			return authenticated;
		}
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
		* 「账户」设置页（`settings.section`）：未登录不给表单；已登录渲染自助改密表单。
		* `t` 缺失时降级到英文词典（不显示键名），由 account-form 承担全部提交逻辑。
		*/
		function SettingsAccountSection({ t }) {
			const authenticated = useSessionStatus();
			const translate = typeof t === "function" ? t : translateFrom(ACCOUNT_DICT_EN);
			if (authenticated === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Notice, { text: translate(ACCOUNT_KEYS.loading) });
			if (!authenticated) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Notice, { text: translate(ACCOUNT_KEYS.loginRequired) });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountPasswordForm, { t: translate });
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
				...ACCOUNT_DICT_ZH
			}), ctx.locale.register(AUTH_NS, "en", {
				[LOGOUT_KEY]: "Sign out",
				...ACCOUNT_DICT_EN
			})], "auth: zh/en dictionaries (logout + account)");
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