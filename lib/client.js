window.__ModuleLoader__.load({
	id: "dsh-auth-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/shared/i18n/passkey-copy.ts
		/**
		* `auth` 词典的 passkey 分片：键名集中常量 + zh/en 两套文案。
		*
		* 与 account / admin 分片同命名域：`account-copy.ts` 把两套词典合并进 `ACCOUNT_DICT_*`，
		* `index.tsx` 注册时自动带上，因此本文件不需要（也不能）改 client 入口。
		* 键名统一 `account.passkey.*` 前缀，避免与 account / admin 的既有键冲突。
		*/
		/** passkey 区块用到的词典键（集中常量，避免散落字符串）。 */
		const PASSKEY_KEYS = {
			title: "account.passkey.title",
			intro: "account.passkey.intro",
			loading: "account.passkey.loading",
			empty: "account.passkey.empty",
			unavailable: "account.passkey.unavailable",
			unauthorized: "account.passkey.unauthorized",
			unsupported: "account.passkey.unsupported",
			colLabel: "account.passkey.colLabel",
			colCreated: "account.passkey.colCreated",
			colLastUsed: "account.passkey.colLastUsed",
			colBackup: "account.passkey.colBackup",
			colActions: "account.passkey.colActions",
			neverUsed: "account.passkey.neverUsed",
			backupEligible: "account.passkey.backupEligible",
			backupState: "account.passkey.backupState",
			deviceBound: "account.passkey.deviceBound",
			add: "account.passkey.add",
			adding: "account.passkey.adding",
			label: "account.passkey.label",
			labelPlaceholder: "account.passkey.labelPlaceholder",
			password: "account.passkey.password",
			passwordHint: "account.passkey.passwordHint",
			code: "account.passkey.code",
			codeHint: "account.passkey.codeHint",
			remove: "account.passkey.remove",
			removing: "account.passkey.removing",
			removeConfirm: "account.passkey.removeConfirm",
			cancel: "account.passkey.cancel",
			successAdd: "account.passkey.successAdd",
			successRemove: "account.passkey.successRemove",
			labelRequired: "account.passkey.labelRequired",
			labelTooLong: "account.passkey.labelTooLong",
			passwordRequired: "account.passkey.passwordRequired",
			invalidCredentials: "account.passkey.invalidCredentials",
			invalidTotp: "account.passkey.invalidTotp",
			forbidden: "account.passkey.forbidden",
			notFound: "account.passkey.notFound",
			badRequest: "account.passkey.badRequest",
			locked: "account.passkey.locked",
			lockedPlain: "account.passkey.lockedPlain",
			generic: "account.passkey.generic",
			settingsTitle: "account.passkey.settingsTitle",
			settingsIntro: "account.passkey.settingsIntro",
			settingsLabel: "account.passkey.settingsLabel",
			settingsSaved: "account.passkey.settingsSaved",
			settingsError: "account.passkey.settingsError",
			count: "account.passkey.count",
			tableCaption: "account.passkey.tableCaption",
			emptyAction: "account.passkey.emptyAction",
			addFormTitle: "account.passkey.addFormTitle",
			removeTitle: "account.passkey.removeTitle",
			removeWarning: "account.passkey.removeWarning",
			settingsSaving: "account.passkey.settingsSaving",
			codeHintOn: "account.passkey.codeHintOn",
			codeHintOff: "account.passkey.codeHintOff",
			retry: "account.passkey.retry"
		};
		/** 中文词典。 */
		const PASSKEY_DICT_ZH = {
			[PASSKEY_KEYS.title]: "通行密钥",
			[PASSKEY_KEYS.intro]: "通行密钥可以免密码登录，且不会被钓鱼站骗走。添加或删除时需要再次输入当前密码。",
			[PASSKEY_KEYS.loading]: "正在加载通行密钥...",
			[PASSKEY_KEYS.empty]: "还没有通行密钥。",
			[PASSKEY_KEYS.unavailable]: "通行密钥列表暂时不可用，请稍后重试。",
			[PASSKEY_KEYS.unauthorized]: "登录状态已失效，请重新登录。",
			[PASSKEY_KEYS.unsupported]: "当前浏览器不支持通行密钥，请换用支持 WebAuthn 的浏览器。",
			[PASSKEY_KEYS.colLabel]: "名称",
			[PASSKEY_KEYS.colCreated]: "创建时间",
			[PASSKEY_KEYS.colLastUsed]: "最近使用",
			[PASSKEY_KEYS.colBackup]: "备份状态",
			[PASSKEY_KEYS.colActions]: "操作",
			[PASSKEY_KEYS.neverUsed]: "从未使用",
			[PASSKEY_KEYS.backupEligible]: "可同步",
			[PASSKEY_KEYS.backupState]: "已备份",
			[PASSKEY_KEYS.deviceBound]: "仅本设备",
			[PASSKEY_KEYS.add]: "添加通行密钥",
			[PASSKEY_KEYS.adding]: "正在等待验证器...",
			[PASSKEY_KEYS.label]: "名称",
			[PASSKEY_KEYS.labelPlaceholder]: "例如：MacBook Touch ID",
			[PASSKEY_KEYS.password]: "当前密码",
			[PASSKEY_KEYS.passwordHint]: "添加或删除通行密钥需要再次验证当前密码。",
			[PASSKEY_KEYS.code]: "动态验证码",
			[PASSKEY_KEYS.codeHint]: "已开启两步验证时填写 6 位动态码，否则留空。",
			[PASSKEY_KEYS.remove]: "删除",
			[PASSKEY_KEYS.removing]: "删除中...",
			[PASSKEY_KEYS.removeConfirm]: "确认删除",
			[PASSKEY_KEYS.cancel]: "取消",
			[PASSKEY_KEYS.successAdd]: "通行密钥已添加。",
			[PASSKEY_KEYS.successRemove]: "通行密钥已删除。",
			[PASSKEY_KEYS.labelRequired]: "请填写通行密钥名称。",
			[PASSKEY_KEYS.labelTooLong]: "名称不能超过 64 个字符。",
			[PASSKEY_KEYS.passwordRequired]: "请输入当前密码。",
			[PASSKEY_KEYS.invalidCredentials]: "当前密码不正确。",
			[PASSKEY_KEYS.invalidTotp]: "动态验证码不正确，或该验证码已被使用。",
			[PASSKEY_KEYS.forbidden]: "没有权限执行此操作，或当前会话不允许。",
			[PASSKEY_KEYS.notFound]: "找不到该通行密钥，可能已被删除。",
			[PASSKEY_KEYS.badRequest]: "请求不合法，请检查填写内容。",
			[PASSKEY_KEYS.locked]: "尝试次数过多，请在 {seconds} 秒后重试。",
			[PASSKEY_KEYS.lockedPlain]: "尝试次数过多，请稍后重试。",
			[PASSKEY_KEYS.generic]: "操作失败，请稍后重试。",
			[PASSKEY_KEYS.settingsTitle]: "登录页通行密钥自动填充",
			[PASSKEY_KEYS.settingsIntro]: "开启后，登录页会把通行密钥放进浏览器自动填充，用户无需先点按钮。",
			[PASSKEY_KEYS.settingsLabel]: "在登录页启用通行密钥自动填充",
			[PASSKEY_KEYS.settingsSaved]: "设置已保存。",
			[PASSKEY_KEYS.settingsError]: "设置保存失败，请稍后重试。",
			[PASSKEY_KEYS.count]: "已注册 {count} 把",
			[PASSKEY_KEYS.tableCaption]: "已注册的通行密钥",
			[PASSKEY_KEYS.emptyAction]: "添加第一把通行密钥",
			[PASSKEY_KEYS.addFormTitle]: "验证身份并添加",
			[PASSKEY_KEYS.removeTitle]: "删除「{label}」？",
			[PASSKEY_KEYS.removeWarning]: "这把通行密钥会立即失效，且无法恢复。",
			[PASSKEY_KEYS.settingsSaving]: "正在保存...",
			[PASSKEY_KEYS.codeHintOn]: "你的账号已开启两步验证，请输入 6 位动态码。",
			[PASSKEY_KEYS.codeHintOff]: "当前未开启两步验证，此栏可留空。",
			[PASSKEY_KEYS.retry]: "重试"
		};
		/** 英文词典（键集合与中文一致）。 */
		const PASSKEY_DICT_EN = {
			[PASSKEY_KEYS.title]: "Passkeys",
			[PASSKEY_KEYS.intro]: "Passkeys sign you in without a password and cannot be phished. Adding or removing one asks for your current password again.",
			[PASSKEY_KEYS.loading]: "Loading passkeys...",
			[PASSKEY_KEYS.empty]: "No passkeys yet.",
			[PASSKEY_KEYS.unavailable]: "The passkey list is temporarily unavailable. Please try again later.",
			[PASSKEY_KEYS.unauthorized]: "Your session has expired. Please sign in again.",
			[PASSKEY_KEYS.unsupported]: "This browser does not support passkeys. Use a WebAuthn-capable browser.",
			[PASSKEY_KEYS.colLabel]: "Name",
			[PASSKEY_KEYS.colCreated]: "Created",
			[PASSKEY_KEYS.colLastUsed]: "Last used",
			[PASSKEY_KEYS.colBackup]: "Backup",
			[PASSKEY_KEYS.colActions]: "Actions",
			[PASSKEY_KEYS.neverUsed]: "Never",
			[PASSKEY_KEYS.backupEligible]: "Synced",
			[PASSKEY_KEYS.backupState]: "Backed up",
			[PASSKEY_KEYS.deviceBound]: "This device",
			[PASSKEY_KEYS.add]: "Add a passkey",
			[PASSKEY_KEYS.adding]: "Waiting for your authenticator...",
			[PASSKEY_KEYS.label]: "Name",
			[PASSKEY_KEYS.labelPlaceholder]: "For example: MacBook Touch ID",
			[PASSKEY_KEYS.password]: "Current password",
			[PASSKEY_KEYS.passwordHint]: "Adding or removing a passkey asks you to verify your current password again.",
			[PASSKEY_KEYS.code]: "Verification code",
			[PASSKEY_KEYS.codeHint]: "Enter the 6-digit code when two-factor authentication is on, otherwise leave it empty.",
			[PASSKEY_KEYS.remove]: "Remove",
			[PASSKEY_KEYS.removing]: "Removing...",
			[PASSKEY_KEYS.removeConfirm]: "Confirm removal",
			[PASSKEY_KEYS.cancel]: "Cancel",
			[PASSKEY_KEYS.successAdd]: "Passkey added.",
			[PASSKEY_KEYS.successRemove]: "Passkey removed.",
			[PASSKEY_KEYS.labelRequired]: "Enter a name for the passkey.",
			[PASSKEY_KEYS.labelTooLong]: "The name must be at most 64 characters.",
			[PASSKEY_KEYS.passwordRequired]: "Enter your current password.",
			[PASSKEY_KEYS.invalidCredentials]: "The current password is incorrect.",
			[PASSKEY_KEYS.invalidTotp]: "The verification code is incorrect or already used.",
			[PASSKEY_KEYS.forbidden]: "You are not allowed to do this, or this session is not allowed to.",
			[PASSKEY_KEYS.notFound]: "That passkey was not found; it may have been removed already.",
			[PASSKEY_KEYS.badRequest]: "The request is invalid. Check the values you entered.",
			[PASSKEY_KEYS.locked]: "Too many attempts. Try again in {seconds} seconds.",
			[PASSKEY_KEYS.lockedPlain]: "Too many attempts. Try again later.",
			[PASSKEY_KEYS.generic]: "The operation failed. Please try again later.",
			[PASSKEY_KEYS.settingsTitle]: "Passkey autofill on the sign-in page",
			[PASSKEY_KEYS.settingsIntro]: "When on, the sign-in page offers passkeys in the browser autofill, so users do not have to press a button first.",
			[PASSKEY_KEYS.settingsLabel]: "Offer passkey autofill on the sign-in page",
			[PASSKEY_KEYS.settingsSaved]: "Settings saved.",
			[PASSKEY_KEYS.settingsError]: "Could not save the setting. Please try again later.",
			[PASSKEY_KEYS.count]: "{count} registered",
			[PASSKEY_KEYS.tableCaption]: "Registered passkeys",
			[PASSKEY_KEYS.emptyAction]: "Add your first passkey",
			[PASSKEY_KEYS.addFormTitle]: "Verify your identity to add one",
			[PASSKEY_KEYS.removeTitle]: "Remove “{label}”?",
			[PASSKEY_KEYS.removeWarning]: "This passkey stops working immediately and cannot be restored.",
			[PASSKEY_KEYS.settingsSaving]: "Saving...",
			[PASSKEY_KEYS.codeHintOn]: "Two-factor is on for your account. Enter the 6-digit code.",
			[PASSKEY_KEYS.codeHintOff]: "Two-factor is off. You can leave this field empty.",
			[PASSKEY_KEYS.retry]: "Retry"
		};
		//#endregion
		//#region src/client/shared/i18n/account-copy.ts
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
			ruleSameAsOld: "account.rule.sameAsOld",
			contextLocal: "account.context.local",
			roleAdmin: "account.role.admin",
			roleUser: "account.role.user",
			totpOn: "account.totp.on",
			totpOff: "account.totp.off",
			codeHintOn: "account.codeHintOn",
			codeHintOff: "account.codeHintOff",
			retry: "account.retry",
			adminAreaTitle: "account.adminArea.title",
			adminAreaIntro: "account.adminArea.intro",
			/**
			* passkey-only 提示（`passkey: "required"`，issue #133）：改密表单仍然可用，但改完不能
			* 用它登录 - 不说明的话，用户会以为改完密码就能回到登录页。
			*/
			passkeyOnlyNotice: "account.passkeyOnlyNotice"
		};
		/** 契约 §2 策略规则名 → 词典键（`satisfies` 保证与契约的 `PasswordRule` 一一对应）。 */
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
			[ACCOUNT_KEYS.passkeyOnlyNotice]: "本实例要求使用通行密钥登录。密码仍可用于在这里修改凭据，但不能用来登录。",
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
			[ACCOUNT_KEYS.ruleSameAsOld]: "不能与当前密码相同",
			[ACCOUNT_KEYS.contextLocal]: "本地账号",
			[ACCOUNT_KEYS.roleAdmin]: "管理员",
			[ACCOUNT_KEYS.roleUser]: "普通用户",
			[ACCOUNT_KEYS.totpOn]: "两步验证已开启",
			[ACCOUNT_KEYS.totpOff]: "两步验证未开启",
			[ACCOUNT_KEYS.codeHintOn]: "你的账号已开启两步验证，请输入 6 位动态码。",
			[ACCOUNT_KEYS.codeHintOff]: "当前未开启两步验证，此栏可留空。",
			[ACCOUNT_KEYS.retry]: "重试",
			[ACCOUNT_KEYS.adminAreaTitle]: "实例管理",
			[ACCOUNT_KEYS.adminAreaIntro]: "管理其他用户和本实例的登录方式。",
			...PASSKEY_DICT_ZH
		};
		/** 英文词典。 */
		const ACCOUNT_DICT_EN = {
			[ACCOUNT_KEYS.nav]: "Account security",
			[ACCOUNT_KEYS.title]: "Change password",
			[ACCOUNT_KEYS.intro]: "After the change, this device is signed out too. Sign in again with your new password.",
			[ACCOUNT_KEYS.scope]: "These are this instance's local sign-in credentials, not your DeepSeek account.",
			[ACCOUNT_KEYS.passkeyOnlyNotice]: "This instance requires a passkey to sign in. Your password still works for changing credentials here, but it cannot be used to sign in.",
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
			[ACCOUNT_KEYS.ruleSameAsOld]: "different from the current password",
			[ACCOUNT_KEYS.contextLocal]: "Local account",
			[ACCOUNT_KEYS.roleAdmin]: "Admin",
			[ACCOUNT_KEYS.roleUser]: "User",
			[ACCOUNT_KEYS.totpOn]: "Two-factor on",
			[ACCOUNT_KEYS.totpOff]: "Two-factor off",
			[ACCOUNT_KEYS.codeHintOn]: "Two-factor is on for your account. Enter the 6-digit code.",
			[ACCOUNT_KEYS.codeHintOff]: "Two-factor is off. You can leave this field empty.",
			[ACCOUNT_KEYS.retry]: "Retry",
			[ACCOUNT_KEYS.adminAreaTitle]: "Instance management",
			[ACCOUNT_KEYS.adminAreaIntro]: "Manage other users and sign-in for this instance.",
			...PASSKEY_DICT_EN
		};
		//#endregion
		//#region src/client/shared/ui/account-icon.ts
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
		//#region src/client/shared/ui/account-styles.ts
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
		const ERROR_TEXT_STYLE = { color: "var(--dsw-alias-state-error-primary)" };
		const SUCCESS_TEXT_STYLE = { color: "var(--dsw-alias-state-success-primary)" };
		const RULES_STYLE = {
			margin: 0,
			paddingLeft: 18,
			color: "var(--dsw-alias-state-error-primary)"
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
		//#region src/client/shared/ui/redesign-styles.ts
		/** 区标题行：标题在左，动作（数量徽标 / 添加按钮）在右。 */
		const SECTION_HEADING_STYLE = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12,
			minHeight: 24
		};
		/** 区标题右侧的动作组。 */
		const SECTION_ACTIONS_STYLE = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			flex: "none"
		};
		/** 行式字段：左标签 + 右控件，与宿主设置页同形。 */
		const FIELD_ROW_STYLE = {
			display: "grid",
			gridTemplateColumns: "148px minmax(0, 1fr)",
			alignItems: "start",
			gap: 16,
			padding: "8px 0",
			borderTop: "1px solid var(--dsw-alias-border-l1)"
		};
		/** 行式字段的标签（可换行，长英文标签不撑破列宽）。 */
		const FIELD_LABEL_STYLE = {
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-primary)",
			paddingTop: 7,
			overflowWrap: "anywhere"
		};
		/** 行式字段的控件列：纵向排布输入 + 帮助文本。 */
		const FIELD_CONTROL_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			minWidth: 0
		};
		/** 行式字段里的输入框（宽度撑满控件列）。 */
		const ROW_INPUT_STYLE = {
			...INPUT_STYLE,
			width: "100%"
		};
		/** 行式字段里校验失败的输入框。 */
		const ROW_INVALID_INPUT_STYLE = {
			...INVALID_INPUT_STYLE,
			width: "100%"
		};
		/** 次级按钮（ghost）：透明底 + 描边，用于「添加」「取消」这类非主任务动作。 */
		const GHOST_BUTTON_STYLE = {
			alignSelf: "flex-start",
			padding: "6px 14px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			fontFamily: "inherit",
			fontSize: 13,
			fontWeight: 500,
			lineHeight: "20px",
			cursor: "pointer"
		};
		/** 次级按钮的 hover / 按下态（内联样式没有伪类，靠 state 切换）。 */
		const GHOST_BUTTON_ACTIVE_STYLE = {
			...GHOST_BUTTON_STYLE,
			background: "var(--dsw-alias-button-ghost-active-fill)",
			borderColor: "var(--dsw-alias-button-ghost-active-border)"
		};
		/** 次级按钮的禁用态。 */
		const GHOST_BUTTON_BUSY_STYLE = {
			...GHOST_BUTTON_STYLE,
			opacity: .6,
			cursor: "default"
		};
		/**
		* 危险按钮：透明底 + 错误色描边与文字。
		*
		* 不复用黑色主按钮：删除凭据、确认重置这类动作不该和主任务同权重（评审 F3）。
		*/
		const DANGER_BUTTON_STYLE = {
			alignSelf: "flex-start",
			padding: "6px 14px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-state-error-primary)",
			background: "transparent",
			color: "var(--dsw-alias-state-error-primary)",
			fontFamily: "inherit",
			fontSize: 13,
			fontWeight: 500,
			lineHeight: "20px",
			cursor: "pointer"
		};
		/** 危险按钮的 hover / 按下态。 */
		const DANGER_BUTTON_ACTIVE_STYLE = {
			...DANGER_BUTTON_STYLE,
			background: "var(--dsw-alias-interactive-bg-hover-danger)"
		};
		/** 危险按钮的禁用态。 */
		const DANGER_BUTTON_BUSY_STYLE = {
			...DANGER_BUTTON_STYLE,
			opacity: .6,
			cursor: "default"
		};
		/**
		* 就地确认区（删除凭据 / 重置他人密码）。
		*
		* 识别靠**描边 + 左侧竖条**，不靠底色：实测 `state-warn-tertiary` 与所在表面的
		* 对比度浅色 1.06、深色 1.02，等于看不见（评审 F3）。底色只作辅助。
		*/
		const CONFIRM_PANEL_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			marginTop: 10,
			padding: "12px 14px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-state-error-primary)",
			borderLeftWidth: 3,
			background: "var(--dsw-alias-state-warn-tertiary)"
		};
		/** 确认区标题。 */
		const CONFIRM_TITLE_STYLE = {
			margin: 0,
			fontSize: 14,
			fontWeight: 600,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-primary)"
		};
		/** 确认区里的后果说明。 */
		const CONFIRM_WARNING_STYLE = {
			margin: 0,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-secondary)"
		};
		/** 确认区底部的动作行：安全动作在左，危险动作在右（避免双击同坐标完成破坏）。 */
		const CONFIRM_ACTIONS_STYLE = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12,
			marginTop: 2
		};
		/** 空态块：浅底 + 一句说明 + 一个下一步动作。 */
		const EMPTY_STATE_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			marginTop: 10,
			padding: "14px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l1)",
			background: "var(--dsw-alias-card-fill)"
		};
		/** 账号上下文行：本地账号 + 角色 / 两步验证徽标。 */
		const ACCOUNT_CONTEXT_STYLE = {
			display: "flex",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 8,
			paddingBottom: 12,
			borderBottom: "1px solid var(--dsw-alias-border-l1)",
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** 上下文行里的账号名。 */
		const ACCOUNT_CONTEXT_NAME_STYLE = {
			fontSize: 14,
			lineHeight: "22px",
			fontWeight: 500,
			color: "var(--dsw-alias-label-primary)"
		};
		/** 凭据行的元数据行（创建 / 最近使用 / 备份），12px 三级色。 */
		const CREDENTIAL_META_STYLE = {
			display: "flex",
			flexWrap: "wrap",
			gap: 8,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** 屏幕阅读器专用（表格 caption 这类需要语义但不需要视觉的文本）。 */
		const VISUALLY_HIDDEN_STYLE = {
			position: "absolute",
			width: 1,
			height: 1,
			padding: 0,
			margin: -1,
			overflow: "hidden",
			clipPath: "inset(50%)",
			whiteSpace: "nowrap",
			border: 0
		};
		//#endregion
		//#region src/client/shared/ui/action-button.tsx
		/**
		* 原生按钮 + 内联样式（重设计 2026-11-16）。
		*
		* 为什么需要它：仓库没有 CSS 文件，`:hover` / `:active` 这类伪类用不了，只能靠
		* `onMouseEnter` / `onMouseLeave` 切 state。三个 feature 都要这套逻辑，放 shared
		* 里复用，但**不带任何业务文案或跨 feature 状态**（FSD 纪律）。
		*
		* 语义保持原生：`type` 默认 `button`（表单里的提交按钮必须显式传 `submit`），
		* 调用方给的 `aria-*` / `ref` / `disabled` 原样透传，不吞。
		*/
		/** 档位 → 三态样式（常态 / hover / busy）。 */
		const VARIANTS = {
			primary: {
				base: BUTTON_STYLE,
				active: BUTTON_STYLE,
				busy: BUTTON_BUSY_STYLE
			},
			ghost: {
				base: GHOST_BUTTON_STYLE,
				active: GHOST_BUTTON_ACTIVE_STYLE,
				busy: GHOST_BUTTON_BUSY_STYLE
			},
			danger: {
				base: DANGER_BUTTON_STYLE,
				active: DANGER_BUTTON_ACTIVE_STYLE,
				busy: DANGER_BUTTON_BUSY_STYLE
			}
		};
		/** 三态选一：禁用 > hover > 常态（拆出来是为了不写嵌套三元）。 */
		function pickStyle(styles, isDisabled, hovered) {
			if (isDisabled) return styles.busy;
			return hovered ? styles.active : styles.base;
		}
		/**
		* 带 hover 反馈的原生按钮。
		*
		* `type` 默认 `button`：表单里的提交按钮必须显式写 `type="submit"`，避免误触发表单。
		*/
		const ActionButton = (0, react.forwardRef)(function ActionButton({ variant = "primary", busy = false, disabled, style, type = "button", ...rest }, ref) {
			const [hovered, setHovered] = (0, react.useState)(false);
			const styles = VARIANTS[variant];
			const isDisabled = disabled === true || busy;
			const base = pickStyle(styles, isDisabled, hovered);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				...rest,
				ref,
				type,
				disabled: isDisabled,
				style: style === void 0 ? base : {
					...base,
					...style
				},
				onMouseEnter: (event) => {
					setHovered(true);
					rest.onMouseEnter?.(event);
				},
				onMouseLeave: (event) => {
					setHovered(false);
					rest.onMouseLeave?.(event);
				}
			});
		});
		//#endregion
		//#region src/client/features/nav-icon/ui/account-nav-icon.ts
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
		//#region src/client/shared/api/form.ts
		/**
		* 把一个请求体对象编码成 `application/x-www-form-urlencoded`。调用方先把对象标注成
		* `src/protocol/` 里的请求体类型（`PasswordChangeRequest` / `AdminResetRequest`），键名就受契约
		* 约束；值为 `undefined` 的可选字段不发送，字段顺序同对象字面量。
		*/
		function encodeForm(fields) {
			const body = new URLSearchParams();
			for (const [name, value] of Object.entries(fields)) if (typeof value === "string") body.set(name, value);
			return body;
		}
		//#endregion
		//#region src/protocol/index.ts
		/** 登录页（GET 渲染、POST 提交）。 */
		const LOGIN_PATH = "/auth/login";
		/** 登出（POST-only，`next` 只从 query 取）。 */
		const LOGOUT_PATH = "/auth/logout";
		/** 会话探针（只认 cookie）。 */
		const STATUS_PATH = "/auth/status";
		/** 已登录用户自己的凭据列表（GET JSON）。 */
		const PASSKEY_PATH = "/auth/passkey";
		/** 注册 begin（已登录 + 再认证的表单 POST，返回 options + 下发 ceremony cookie）。 */
		const PASSKEY_REGISTER_OPTIONS_PATH = "/auth/passkey/register/options";
		/** 注册 finish（已登录表单 POST，attestation → 写 users.yaml）。 */
		const PASSKEY_REGISTER_PATH = "/auth/passkey/register";
		/** 删除自己的凭据（已登录表单 POST；删最后一把或 `--all` 需再认证）。 */
		const PASSKEY_REMOVE_PATH = "/auth/passkey/remove";
		/** 条件 UI（登录页 passkey 自动填充）开关（admin GET/POST）。 */
		const PASSKEY_SETTINGS_PATH = "/auth/passkey/settings";
		/** 自助改密（GET SSR 页，POST 提交）；也是受限会话被拒时的导航目标。 */
		const PASSWORD_PATH = "/auth/password";
		/** 管理面：用户列表。 */
		const USERS_PATH = "/auth/users";
		/** 管理面：管理员重置他人口令。 */
		const USERS_PASSWORD_PATH = "/auth/users/password";
		/** 改密成功后 client 把当前设备送去的登录页（回首页，并带上被登出的原因键）。 */
		const PASSWORD_CHANGED_LOGIN_URL = `${LOGIN_PATH}?next=%2F&notice=password-changed`;
		/** 设置页「退出登录」按钮的提交目标（登出后回首页）。 */
		const LOGOUT_URL = `${LOGOUT_PATH}?next=/`;
		//#endregion
		//#region src/client/features/change-password/lib/account-redirect.ts
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
		* URL 与原因键都来自跨半边契约 `src/protocol/`（D31），与服务端 `PASSWORD_CHANGED_NOTICE`
		* 是同一个常量，不再靠两侧各写字面量再用源码文本比对钉住。
		*/
		const LOGIN_REDIRECT_URL = PASSWORD_CHANGED_LOGIN_URL;
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
		//#region src/client/features/change-password/ui/account-fields.tsx
		/**
		* 改密表单的字段与状态区（重设计 2026-11-16：改成宿主设置页的行式布局）。
		*
		* 结构钉点（测试依赖，不能改）：四个 input 的 `name` 与顺序是
		* `current` / `password` / `confirm` / `code`；`ACCOUNT_STATUS_ID` 是常驻
		* `role="status" aria-live="polite"` 节点，也是错误字段 `aria-describedby` 的落点。
		*
		* 重设计新增：新密码框下常驻策略说明（原来只在失败后才说）、动态码提示按
		* `totpEnabled` 状态化（原来恒说「已开启时填写」，未开启的用户会以为要填）。
		*/
		/** 字段/节点 id 前缀（一个面板只有一个实例，静态 id 即可）。 */
		const PREFIX$2 = "dsh-auth-gate-account";
		/** 状态区 id：aria-live 播报位，也是错误字段 aria-describedby 的落点（成功态复用）。 */
		const ACCOUNT_STATUS_ID = `${PREFIX$2}-status`;
		/** 动态验证码输入提示 id。 */
		const CODE_HINT_ID$2 = `${PREFIX$2}-code-hint`;
		/** 新密码策略说明 id（常驻，不是错误态才出现）。 */
		const POLICY_HINT_ID = `${PREFIX$2}-policy-hint`;
		/** 字段 id（label htmlFor / aria 关联复用）。 */
		function fieldId$1(name) {
			return `${PREFIX$2}-${name}`;
		}
		/** 行式字段：左标签 + 右控件（输入 + 帮助文本）。 */
		function Field({ id, name, label, type, autoComplete, value, invalid, onChange, hint, hintId, inputMode, readOnly }) {
			const described = [invalid ? ACCOUNT_STATUS_ID : void 0, hintId].filter((item) => item !== void 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: FIELD_ROW_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					htmlFor: id,
					style: FIELD_LABEL_STYLE,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: FIELD_CONTROL_STYLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id,
						name,
						type,
						value,
						autoComplete,
						inputMode,
						readOnly,
						"aria-invalid": invalid ? "true" : void 0,
						"aria-describedby": described.length === 0 ? void 0 : described.join(" "),
						style: invalid ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE,
						onChange: (event) => onChange(event.target.value)
					}), hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: hintId,
						style: HINT_STYLE,
						children: hint
					})]
				})]
			});
		}
		/** 四字段（current / password / confirm / code），autocomplete 按语义固定。 */
		function PasswordFields({ t, values, isInvalid, onChange, readOnly, totpEnabled }) {
			const codeHint = totpEnabled === void 0 ? t(ACCOUNT_KEYS.codeHint) : t(totpEnabled ? ACCOUNT_KEYS.codeHintOn : ACCOUNT_KEYS.codeHintOff);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					id: fieldId$1("current"),
					name: "current",
					label: t(ACCOUNT_KEYS.current),
					type: "password",
					autoComplete: "current-password",
					value: values.current,
					invalid: isInvalid("current"),
					readOnly,
					onChange: (value) => onChange("current", value)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					id: fieldId$1("password"),
					name: "password",
					label: t(ACCOUNT_KEYS.password),
					type: "password",
					autoComplete: "new-password",
					value: values.password,
					invalid: isInvalid("password"),
					readOnly,
					hint: t(ACCOUNT_KEYS.policyHint),
					hintId: POLICY_HINT_ID,
					onChange: (value) => onChange("password", value)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					id: fieldId$1("confirm"),
					name: "confirm",
					label: t(ACCOUNT_KEYS.confirm),
					type: "password",
					autoComplete: "new-password",
					value: values.confirm,
					invalid: isInvalid("confirm"),
					readOnly,
					onChange: (value) => onChange("confirm", value)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					id: fieldId$1("code"),
					name: "code",
					label: t(ACCOUNT_KEYS.code),
					type: "text",
					inputMode: "numeric",
					autoComplete: "one-time-code",
					value: values.code,
					invalid: isInvalid("code"),
					readOnly,
					hint: codeHint,
					hintId: CODE_HINT_ID$2,
					onChange: (value) => onChange("code", value)
				})
			] });
		}
		/**
		* 状态区：常驻 DOM 的 aria-live 播报位（idle 时留空，避免读屏漏播）。
		*
		* `tabIndex={-1}` 让无字段的全局错误（429 / 503 / 网络）能把焦点落到这里，
		* 读屏用户不用自己找（评审 F4 的焦点落点）。
		*/
		function StatusLine({ failure }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				id: ACCOUNT_STATUS_ID,
				role: "status",
				"aria-live": "polite",
				tabIndex: -1,
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
		//#region src/client/features/change-password/ui/account-header.tsx
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
		/** 角色 / 两步验证的文案键（未知取值不显示，不发明文案）。 */
		function roleKey(role) {
			return role === "admin" ? ACCOUNT_KEYS.roleAdmin : ACCOUNT_KEYS.roleUser;
		}
		/**
		* 账号上下文行：`本地账号 <name> [角色] [两步验证]`。
		*
		* 三个字段全缺时整行不渲染（旧服务端只回 `authenticated` 的情况），不占位。
		*/
		function AccountContext({ t, name, role, totpEnabled }) {
			if (name === void 0 && role === void 0 && totpEnabled === void 0) return null;
			const badges = [];
			if (role !== void 0) badges.push(t(roleKey(role)));
			if (totpEnabled !== void 0) badges.push(t(totpEnabled ? ACCOUNT_KEYS.totpOn : ACCOUNT_KEYS.totpOff));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: ACCOUNT_CONTEXT_STYLE,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(ACCOUNT_KEYS.contextLocal) }),
					name === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: ACCOUNT_CONTEXT_NAME_STYLE,
						children: name
					}),
					badges.map((text) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: ADMIN_BADGE_STYLE,
						children: text
					}, text))
				]
			});
		}
		/** 标题行 + 说明。`h2` 与 16×16 `aria-hidden` svg 是既有测试钉住的形状，不能改。 */
		function AccountHeader({ t, showIntro = true }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", {
				style: TITLE_ROW_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountIcon, {}), t(ACCOUNT_KEYS.title)]
			}), showIntro ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: HINT_STYLE,
				children: t(ACCOUNT_KEYS.intro)
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: HINT_STYLE,
				children: t(ACCOUNT_KEYS.scope)
			})] }) : null] });
		}
		//#endregion
		//#region src/client/features/change-password/model/account-submit.ts
		/** 自助改密端点（契约 §1：POST + application/x-www-form-urlencoded）。 */
		const PASSWORD_TARGET = PASSWORD_PATH;
		const EMPTY_VALUES = {
			current: "",
			password: "",
			confirm: "",
			code: ""
		};
		/** 错误码比较：码的字面量受契约约束，写错码编译不过；值本身仍是未校验的 `unknown`。 */
		function isError$2(value, code) {
			return value === code;
		}
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
			if (status === 401) return isError$2(body.error, "invalid_totp") ? {
				message: t(ACCOUNT_KEYS.invalidTotp),
				rules: [],
				fields: ["code"]
			} : {
				message: t(ACCOUNT_KEYS.invalidCredentials),
				rules: [],
				fields: ["current"]
			};
			if (status === 400 && isError$2(body.error, "policy")) {
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
			const request = {
				current: values.current,
				password: values.password,
				code: values.code
			};
			return fetch(PASSWORD_TARGET, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: encodeForm(request),
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
		//#region src/client/features/change-password/ui/account-form.tsx
		/** 字段的文档顺序：失败后按这个顺序找第一个错误字段聚焦。 */
		const FIELD_ORDER$1 = [
			"current",
			"password",
			"confirm",
			"code"
		];
		/** 字段 id（与 account-fields.tsx 的 `fieldId` 同形；聚焦要用）。 */
		function fieldElementId$1(field) {
			return `dsh-auth-gate-account-${field}`;
		}
		/**
		* 表单状态机：
		* - 双锁 = in-flight ref（硬锁，Enter/点击并发都挡）+ submitting 按钮 disabled（可见锁）；
		* - IME 组合期由 composing ref 挡住，避免中文输入法确认键提交；
		* - 请求带 AbortController，卸载即 abort，回调再看 mounted，绝不卸载后 setState；
		* - 编辑任一字段清掉上一轮错误（重设计：原来改正后红框还在）；
		* - 失败后把焦点落到第一个错误字段，无字段错误落到状态位。
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
			/** 失败落点：有字段错误聚焦第一个，否则聚焦状态位（tabIndex=-1）。 */
			const focusFailure = (view) => {
				const first = FIELD_ORDER$1.find((field) => view.fields.includes(field));
				(first === void 0 ? document.getElementById(ACCOUNT_STATUS_ID) : document.getElementById(fieldElementId$1(first)))?.focus();
			};
			const setValue = (field, value) => {
				setValues((previous) => ({
					...previous,
					[field]: value
				}));
				setFailure(null);
			};
			const submit = async () => {
				if (lock.current) return;
				const invalid = validate(values, t);
				if (invalid !== null) {
					setFailure(invalid);
					focusFailure(invalid);
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
					if (result.kind === "failure") {
						setFailure(result.failure);
						focusFailure(result.failure);
					}
				} catch {
					if (!live()) return;
					const generic = {
						message: t(ACCOUNT_KEYS.generic),
						rules: [],
						fields: []
					};
					setFailure(generic);
					focusFailure(generic);
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
		function AccountPasswordForm({ t, totpEnabled }) {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountHeader, {
						t,
						showIntro: false
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						id: ACCOUNT_STATUS_ID,
						role: "status",
						"aria-live": "polite",
						style: SUCCESS_TEXT_STYLE,
						children: form.success
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						ref: reloginButton,
						onClick: form.relogin,
						children: t(ACCOUNT_KEYS.relogin)
					})
				]
			});
			const isInvalid = (field) => form.failure?.fields.includes(field) === true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: PANEL_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountHeader, { t }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
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
							onChange: form.setValue,
							readOnly: form.submitting,
							totpEnabled
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusLine, { failure: form.failure }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							type: "submit",
							busy: form.submitting,
							children: form.submitting ? t(ACCOUNT_KEYS.submitting) : t(ACCOUNT_KEYS.submit)
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/features/passkey/api/passkey-codec.ts
		/**
		* WebAuthn 的浏览器侧编解码（M6 PR3）：base64url ↔ ArrayBuffer、库 options JSON →
		* `navigator.credentials.create` 的 `publicKey`、认证器 transports 提取、特性检测。
		*
		* 手写而不引 `@simplewebauthn/browser`：client bundle 保持零第三方依赖（与登录页同一约束）。
		* 这里不是安全边界（服务端用库校验），只是把 JSON 形状转成浏览器 API 要的二进制。
		*/
		/** 对象守卫：只用于读未校验的 JSON。 */
		function isRecord$4(value) {
			return typeof value === "object" && value !== null;
		}
		/** base64url → ArrayBuffer（补 padding；`atob` 只认标准 base64）。 */
		function decodeBase64Url(value) {
			const text = value.replace(/-/g, "+").replace(/_/g, "/");
			const padded = text + "=".repeat((4 - text.length % 4) % 4);
			const binary = atob(padded);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			return bytes.buffer;
		}
		/** ArrayBuffer → base64url（无 padding）。 */
		function encodeBase64Url(value) {
			const bytes = new Uint8Array(value);
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
		}
		/** 浏览器是否支持 WebAuthn（`PublicKeyCredential` 存在且 `credentials.create` 可用）。 */
		function isPasskeySupported() {
			const scope = globalThis;
			return typeof scope.PublicKeyCredential === "function" && typeof scope.navigator?.credentials?.create === "function";
		}
		/** 把 options JSON 转成 `navigator.credentials.create` 的 `publicKey`；形状非法返回 undefined。 */
		function toCreationOptions(raw) {
			if (!isRecord$4(raw)) return void 0;
			const options = raw;
			if (typeof options.challenge !== "string") return void 0;
			if (!isRecord$4(options.rp) || !isRecord$4(options.user)) return void 0;
			if (typeof options.user.id !== "string") return void 0;
			if (!Array.isArray(options.pubKeyCredParams)) return void 0;
			const publicKey = {
				challenge: decodeBase64Url(options.challenge),
				rp: {
					name: String(options.rp.name ?? ""),
					...typeof options.rp.id === "string" ? { id: options.rp.id } : {}
				},
				user: {
					id: decodeBase64Url(options.user.id),
					name: String(options.user.name ?? ""),
					displayName: String(options.user.displayName ?? "")
				},
				pubKeyCredParams: options.pubKeyCredParams.map((param) => ({
					type: "public-key",
					alg: param.alg
				}))
			};
			if (typeof options.timeout === "number") publicKey.timeout = options.timeout;
			if (Array.isArray(options.excludeCredentials)) publicKey.excludeCredentials = options.excludeCredentials.map((item) => ({
				type: "public-key",
				id: decodeBase64Url(item.id),
				...Array.isArray(item.transports) ? { transports: item.transports } : {}
			}));
			applyOptionalOptions(publicKey, options);
			return publicKey;
		}
		/** 可选字段：库透传什么就带什么，缺省不写（`exactOptionalPropertyTypes` 下不能写 undefined）。 */
		function applyOptionalOptions(publicKey, options) {
			if (isRecord$4(options.authenticatorSelection)) publicKey.authenticatorSelection = options.authenticatorSelection;
			if (typeof options.attestation === "string") publicKey.attestation = options.attestation;
			if (isRecord$4(options.extensions)) publicKey.extensions = options.extensions;
		}
		/** 认证器上报的 transports（逗号分隔，与 host 的 `parseTransports` 同口径）。 */
		function transportsOf(credential) {
			const response = credential.response;
			return (typeof response.getTransports === "function" ? response.getTransports() : []).join(",");
		}
		/** 用户取消（`NotAllowedError`）与超时都按「中止」处理：不显示错误，恢复按钮即可。 */
		function isCancelled(error) {
			if (!isRecord$4(error)) return false;
			return error["name"] === "AbortError" || error["name"] === "NotAllowedError";
		}
		//#endregion
		//#region src/client/features/passkey/ui/passkey-add-form.tsx
		/**
		* 「添加通行密钥」表单（重设计 2026-11-16：默认收起，展开后带标题与取消）。
		*
		* 再认证是安全红线：会话本身不足以注册（防「会话被劫 → 加后门 passkey」），
		* 所以口令字段必填，TOTP 码在服务端开启两步验证时必填（客户端不判断，留空即不发）。
		*
		* 重设计：这个表单一年用一次，常驻展开会占掉约 300px 首屏（评审：低频表单不该和
		* 主任务抢空间）。现在由父组件按需挂载，展开时聚焦名称框，取消后焦点回触发按钮。
		*/
		/** 字段 id（与 use-passkey-actions 的 `addFieldId` 同形）。 */
		function fieldId(field) {
			return `dsh-auth-gate-passkey-${field}`;
		}
		/** 动态码提示 id。 */
		const CODE_HINT_ID$1 = "dsh-auth-gate-passkey-code-hint";
		/** 状态播报位 id（与列表共用同一个 passkey 状态位）。 */
		const STATUS_ID$2 = "dsh-auth-gate-passkey-status";
		/** 行式输入（与改密表单同形）。 */
		function AddField({ field, label, type, autoComplete, value, invalid, hint, hintId, inputMode, onChange }) {
			const id = fieldId(field);
			const described = [invalid ? STATUS_ID$2 : void 0, hintId].filter((item) => item !== void 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: FIELD_ROW_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					htmlFor: id,
					style: FIELD_LABEL_STYLE,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: FIELD_CONTROL_STYLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id,
						name: field,
						type,
						value,
						autoComplete,
						inputMode,
						"aria-invalid": invalid ? "true" : void 0,
						"aria-describedby": described.length === 0 ? void 0 : described.join(" "),
						style: invalid ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE,
						onChange: (event) => onChange(event.target.value)
					}), hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: hintId,
						style: HINT_STYLE,
						children: hint
					})]
				})]
			});
		}
		/** 三个字段的组合（名称 / 当前口令 / 动态码）。 */
		function AddFields({ t, values, isInvalid, codeHint, labelRef, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: FIELD_ROW_STYLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						htmlFor: fieldId("label"),
						style: FIELD_LABEL_STYLE,
						children: t(PASSKEY_KEYS.label)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: FIELD_CONTROL_STYLE,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							ref: labelRef,
							id: fieldId("label"),
							name: "label",
							type: "text",
							autoComplete: "off",
							placeholder: t(PASSKEY_KEYS.labelPlaceholder),
							value: values.label,
							"aria-invalid": isInvalid("label") ? "true" : void 0,
							"aria-describedby": isInvalid("label") ? STATUS_ID$2 : void 0,
							style: isInvalid("label") ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE,
							onChange: (event) => onChange("label", event.target.value)
						})
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddField, {
					field: "password",
					label: t(PASSKEY_KEYS.password),
					type: "password",
					autoComplete: "current-password",
					value: values.password,
					invalid: isInvalid("password"),
					hint: t(PASSKEY_KEYS.passwordHint),
					onChange: (value) => onChange("password", value)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddField, {
					field: "code",
					label: t(PASSKEY_KEYS.code),
					type: "text",
					autoComplete: "one-time-code",
					inputMode: "numeric",
					value: values.code,
					invalid: isInvalid("code"),
					hint: codeHint,
					hintId: CODE_HINT_ID$1,
					onChange: (value) => onChange("code", value)
				})
			] });
		}
		/** 添加表单：提交由父组件的状态机接管（校验、双锁、abort 都在那里）。 */
		function PasskeyAddForm({ t, values, invalid, busy, totpEnabled, onChange, onSubmit, onCancel }) {
			const labelRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				labelRef.current?.focus();
			}, []);
			const isInvalid = (field) => invalid.includes(field);
			const codeHint = totpEnabled === void 0 ? t(PASSKEY_KEYS.codeHint) : t(totpEnabled ? PASSKEY_KEYS.codeHintOn : PASSKEY_KEYS.codeHintOff);
			const submit = (event) => {
				event.preventDefault();
				onSubmit();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 8
				},
				noValidate: true,
				"aria-busy": busy,
				onSubmit: submit,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: SECTION_HEADING_STYLE,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							style: TITLE_STYLE,
							children: t(PASSKEY_KEYS.addFormTitle)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddFields, {
						t,
						values,
						isInvalid,
						codeHint,
						labelRef,
						onChange
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: CONFIRM_ACTIONS_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							variant: "ghost",
							onClick: onCancel,
							disabled: busy,
							children: t(PASSKEY_KEYS.cancel)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							type: "submit",
							busy,
							children: busy ? t(PASSKEY_KEYS.adding) : t(PASSKEY_KEYS.add)
						})]
					})
				]
			});
		}
		/** 状态播报位：aria-live 落点，也是错误字段 aria-describedby 的目标。 */
		const PASSKEY_STATUS_ID = `dsh-auth-gate-passkey-status`;
		/** 状态区：失败消息（错误色）+ 就地成功文案（成功色），常驻 aria-live 播报位。 */
		function PasskeyStatus({ failure, success }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				id: PASSKEY_STATUS_ID,
				role: "status",
				"aria-live": "polite",
				style: STATUS_STYLE,
				children: [failure === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: ERROR_TEXT_STYLE,
					children: failure.message
				}), success === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: SUCCESS_TEXT_STYLE,
					children: success
				})]
			});
		}
		//#endregion
		//#region src/client/features/passkey/ui/passkey-remove-form.tsx
		/**
		* 删除通行密钥的就地确认区（重设计 2026-11-16）。
		*
		* 为什么不是 `window.confirm`：确认区要承载再认证字段（当前口令 + 动态码）、持久错误
		* 和明确的「删的是哪一把」；`confirm` 三样都做不到，而且会打断焦点。
		*
		* 为什么不是 modal：当前技术形态没有 portal，行内确认能保持目标上下文（用户刚点的那一行
		* 就在上面），也少一层焦点陷阱。
		*
		* 安全细节：安全动作（取消）在左、危险动作（确认删除）在右，避免双击在同一坐标直接完成
		* 破坏；打开时焦点落在口令框，不是危险按钮。
		*/
		/** 删除确认区的字段 id（与添加表单分开，避免同 id 冲突）。 */
		function reauthFieldId$1(field) {
			return `dsh-auth-gate-passkey-remove-${field}`;
		}
		/** 动态码提示 id。 */
		const CODE_HINT_ID = "dsh-auth-gate-passkey-remove-code-hint";
		/** 状态播报位 id（与添加表单共用同一个 passkey 状态位）。 */
		const STATUS_ID$1 = "dsh-auth-gate-passkey-status";
		/** 行式输入（与改密表单同形，但 id 前缀是删除专用）。 */
		function ReauthField({ field, label, type, autoComplete, value, invalid, hint, hintId, inputMode, onChange }) {
			const id = reauthFieldId$1(field);
			const described = [invalid ? STATUS_ID$1 : void 0, hintId].filter((item) => item !== void 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: FIELD_ROW_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					htmlFor: id,
					style: FIELD_LABEL_STYLE,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: FIELD_CONTROL_STYLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id,
						name: field,
						type,
						value,
						autoComplete,
						inputMode,
						"aria-invalid": invalid ? "true" : void 0,
						"aria-describedby": described.length === 0 ? void 0 : described.join(" "),
						style: invalid ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE,
						onChange: (event) => onChange(event.target.value)
					}), hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: hintId,
						style: HINT_STYLE,
						children: hint
					})]
				})]
			});
		}
		/** 删除确认区：标题（含凭据名）+ 后果说明 + 再认证字段 + 取消/确认。 */
		function PasskeyRemoveForm({ t, label, values, invalid, busy, totpEnabled, onChange, onCancel, onConfirm }) {
			const passwordRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				passwordRef.current?.focus();
			}, []);
			const isInvalid = (field) => invalid.includes(field);
			const codeHint = totpEnabled === void 0 ? t(PASSKEY_KEYS.codeHint) : t(totpEnabled ? PASSKEY_KEYS.codeHintOn : PASSKEY_KEYS.codeHintOff);
			const submit = (event) => {
				event.preventDefault();
				onConfirm();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				style: CONFIRM_PANEL_STYLE,
				noValidate: true,
				"aria-busy": busy,
				onSubmit: submit,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						style: CONFIRM_TITLE_STYLE,
						children: t(PASSKEY_KEYS.removeTitle, { label })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: CONFIRM_WARNING_STYLE,
						children: t(PASSKEY_KEYS.removeWarning)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: FIELD_ROW_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: reauthFieldId$1("password"),
							style: FIELD_LABEL_STYLE,
							children: t(PASSKEY_KEYS.password)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: FIELD_CONTROL_STYLE,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: passwordRef,
								id: reauthFieldId$1("password"),
								name: "password",
								type: "password",
								autoComplete: "current-password",
								value: values.password,
								"aria-invalid": isInvalid("password") ? "true" : void 0,
								"aria-describedby": isInvalid("password") ? STATUS_ID$1 : void 0,
								style: isInvalid("password") ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE,
								onChange: (event) => onChange("password", event.target.value)
							})
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReauthField, {
						field: "code",
						label: t(PASSKEY_KEYS.code),
						type: "text",
						autoComplete: "one-time-code",
						inputMode: "numeric",
						value: values.code,
						invalid: isInvalid("code"),
						hint: codeHint,
						hintId: CODE_HINT_ID,
						onChange: (value) => onChange("code", value)
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: CONFIRM_ACTIONS_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							variant: "ghost",
							onClick: onCancel,
							disabled: busy,
							children: t(PASSKEY_KEYS.cancel)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							variant: "danger",
							type: "submit",
							busy,
							children: busy ? t(PASSKEY_KEYS.removing) : t(PASSKEY_KEYS.removeConfirm)
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/features/passkey/ui/passkey-table.tsx
		/**
		* 通行密钥列表（重设计 2026-11-16：五列压成两列）。
		*
		* 原来固定渲染名称 / 创建时间 / 最近使用 / 备份状态 / 操作五列，在 612px 内容列里
		* 每列只剩 80–190px，长名称和多语言表头互相挤压（评审 F7）。现在：
		* - 第一列是行头（`<th scope="row">`）放名称 + transports；
		* - 名称下面一行 12px 元数据同时呈现创建、最近使用、备份，不再各占一列；
		* - 第二列只有操作。
		*
		* 表格保留 `<caption>`（屏幕阅读器需要知道这是「已注册的通行密钥」），视觉上隐藏。
		* 保持服务端顺序（createdAt 升序），不重排。
		*/
		/**
		* epoch ms → `YYYY-MM-DD`，按**本地时区**取日期。
		*
		* 不能用 `toISOString().slice(0, 10)`：那是 UTC 日期，东八区用户在 UTC 16:00 之后
		* 创建的凭据会显示成「昨天」。这里用 `Intl.DateTimeFormat` 的 `sv-SE` 区域（它天然
		* 输出 `YYYY-MM-DD`），显式传 `timeZone` 让测试可以钉住时区而不依赖运行环境。
		*/
		function formatPasskeyDate(value, timeZone) {
			const options = {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				...timeZone === void 0 ? {} : { timeZone }
			};
			return new Intl.DateTimeFormat("sv-SE", options).format(new Date(value));
		}
		/** 备份状态徽标：已备份 > 可同步 > 仅本设备（互斥，按信息量从强到弱）。 */
		function backupText(passkey, t) {
			if (passkey.backupState) return t(PASSKEY_KEYS.backupState);
			if (passkey.backupEligible) return t(PASSKEY_KEYS.backupEligible);
			return t(PASSKEY_KEYS.deviceBound);
		}
		/** 一行凭据的元数据：创建 / 最近使用 / 备份，用 `·` 分隔。 */
		function metaText(passkey, t) {
			const created = t(PASSKEY_KEYS.colCreated);
			const lastUsed = t(PASSKEY_KEYS.colLastUsed);
			const backup = t(PASSKEY_KEYS.colBackup);
			const used = passkey.lastUsedAt === 0 ? t(PASSKEY_KEYS.neverUsed) : formatPasskeyDate(passkey.lastUsedAt);
			return `${created} ${formatPasskeyDate(passkey.createdAt)} · ${lastUsed} ${used} · ${backup} ${backupText(passkey, t)}`;
		}
		/** 凭据表：空列表由调用方渲染空态，这里只负责有数据时的表格。 */
		function PasskeyTable({ t, passkeys, removing, pendingRemove, onRequestRemove, renderConfirm }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
				style: ADMIN_TABLE_STYLE,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("caption", {
						style: VISUALLY_HIDDEN_STYLE,
						children: t(PASSKEY_KEYS.tableCaption)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
						style: ADMIN_TH_STYLE,
						children: t(PASSKEY_KEYS.colLabel)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
						style: {
							...ADMIN_TH_STYLE,
							textAlign: "right"
						},
						children: t(PASSKEY_KEYS.colActions)
					})] }) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: passkeys.map((passkey) => {
						const busy = removing === passkey.idPrefix;
						const confirming = pendingRemove === passkey.idPrefix;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
							scope: "row",
							style: {
								...ADMIN_TD_STYLE,
								textAlign: "left",
								fontWeight: 400
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: passkey.label }),
								passkey.transports.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: HINT_STYLE,
									children: [" ", passkey.transports.join(", ")]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: CREDENTIAL_META_STYLE,
									children: metaText(passkey, t)
								}),
								confirming ? renderConfirm(passkey) : null
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							style: {
								...ADMIN_TD_STYLE,
								textAlign: "right",
								verticalAlign: "top"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								variant: "danger",
								busy,
								"aria-expanded": confirming,
								onClick: () => onRequestRemove(passkey.idPrefix),
								children: busy ? t(PASSKEY_KEYS.removing) : t(PASSKEY_KEYS.remove)
							})
						})] }, passkey.idPrefix);
					}) })
				]
			});
		}
		//#endregion
		//#region src/client/features/passkey/model/passkey-form.ts
		/** 表单初值：提交成功后清回这一份。 */
		const EMPTY_PASSKEY_FORM = {
			label: "",
			password: "",
			code: ""
		};
		/** 再认证初值。 */
		const EMPTY_PASSKEY_REAUTH = {
			password: "",
			code: ""
		};
		/**
		* 本地校验闭表：label → password（code 可选，不校验）。
		* `label` 用 `trim()` 判空与长度（名称两端空白无意义），口令字段不 trim。
		*/
		function validatePasskeyForm(values, t) {
			const label = values.label.trim();
			if (label === "") return {
				message: t(PASSKEY_KEYS.labelRequired),
				fields: ["label"]
			};
			if (label.length > 64) return {
				message: t(PASSKEY_KEYS.labelTooLong),
				fields: ["label"]
			};
			if (values.password === "") return {
				message: t(PASSKEY_KEYS.passwordRequired),
				fields: ["password"]
			};
			return null;
		}
		/**
		* 删除前的本地校验：只要求当前口令。
		*
		* 动态码不在这里判：服务端只在「删最后一把」或 `all=1` 时才强制再认证，普通单删会
		* 忽略它。客户端统一要求口令（与 UI 文案承诺一致），码留空即不发。
		*/
		function validatePasskeyReauth(values, t) {
			if (values.password === "") return {
				message: t(PASSKEY_KEYS.passwordRequired),
				fields: ["password"]
			};
			return null;
		}
		/** 错误码比较：码的字面量受契约约束，写错码编译不过；值本身仍是未校验的 `unknown`。 */
		function isError$1(value, code) {
			return value === code;
		}
		/**
		* 再认证的 TOTP 失败码。契约的 `PasskeyAdminErrorBody["error"]` 联合里没有它（与口令改密
		* 端点同形，401 下用 `invalid_totp` 区分「码错」与「口令错」），所以这里按字面量比较，
		* 不扩契约类型（`src/protocol/` 不在本 PR 的写域）。
		*/
		const INVALID_TOTP = "invalid_totp";
		function isRecord$3(value) {
			return typeof value === "object" && value !== null;
		}
		/** 读错误体字段：`Unchecked<T>` 的索引签名在 `noPropertyAccessFromIndexSignature` 下要方括号，
		* 但 ESLint 又要求点号；这里统一收口成一个取值函数，两处规则都不再打架。 */
		function fieldOf(record, name) {
			return record[name];
		}
		/**
		* 状态码矩阵 → 文案键（与 host 的 `PasskeyAdminErrorBody` 对齐）：
		* 400 bad_request、401 unauthorized、403 forbidden、404 not_found、429 locked(+retryAfter)、
		* 503 unavailable，其余一律 generic。`reason` 只用于区分「最后一枚凭据」这类策略拒绝。
		*/
		function describePasskeyFailure(status, body, t) {
			const record = isRecord$3(body) ? body : {};
			const error = fieldOf(record, "error");
			if (status === 400) return {
				message: t(PASSKEY_KEYS.badRequest),
				fields: []
			};
			if (status === 401) {
				if (isError$1(error, "unauthorized")) return {
					message: t(PASSKEY_KEYS.unauthorized),
					fields: []
				};
				if (error === INVALID_TOTP) return {
					message: t(PASSKEY_KEYS.invalidTotp),
					fields: ["code"]
				};
				return {
					message: t(PASSKEY_KEYS.invalidCredentials),
					fields: ["password"]
				};
			}
			if (status === 403) return {
				message: t(PASSKEY_KEYS.forbidden),
				fields: []
			};
			if (status === 404) return {
				message: t(PASSKEY_KEYS.notFound),
				fields: []
			};
			if (status === 429) {
				const retryAfter = fieldOf(record, "retryAfter");
				return typeof retryAfter === "number" ? {
					message: t(PASSKEY_KEYS.locked, { seconds: retryAfter }),
					fields: []
				} : {
					message: t(PASSKEY_KEYS.lockedPlain),
					fields: []
				};
			}
			if (status === 503) return {
				message: t(PASSKEY_KEYS.unavailable),
				fields: []
			};
			return {
				message: t(PASSKEY_KEYS.generic),
				fields: []
			};
		}
		/** 401 且错误码是 `invalid_totp` 时把焦点指向验证码框（口令正确、码错）。 */
		function isInvalidTotp(status, body) {
			return status === 401 && isRecord$3(body) && fieldOf(body, "error") === INVALID_TOTP;
		}
		//#endregion
		//#region src/client/features/passkey/api/passkey-http.ts
		/**
		* passkey 管理面 API 的共享小件：JSON 读取与对象守卫。
		*
		* 单独成文件是为了让 list / mutate / settings 三个 API 文件都短于 250 行，
		* 且不互相 import（同层文件之间只共享这一个叶子）。
		*/
		/** 对象守卫：只用于读未校验的 JSON。 */
		function isRecord$2(value) {
			return typeof value === "object" && value !== null;
		}
		/** 读 JSON；非对象或解析失败统一回空体（映射只看状态码）。 */
		async function readJsonSafe$1(res) {
			try {
				return await res.json();
			} catch {
				return {};
			}
		}
		//#endregion
		//#region src/client/features/passkey/api/passkey-mutate.ts
		/**
		* passkey 注册与删除（M6 PR3）：再认证 + `navigator.credentials.create` + 表单 POST。
		*
		* 注册必须带当前口令（+ 可选 TOTP 码）：会话本身不足以注册，这是「会话被劫 → 加后门
		* passkey」的唯一堵点。删除同样带再认证凭据（删最后一把时服务端强制校验）。
		*/
		const REGISTER_OPTIONS_TARGET = PASSKEY_REGISTER_OPTIONS_PATH;
		const REGISTER_TARGET = PASSKEY_REGISTER_PATH;
		const REMOVE_TARGET = PASSKEY_REMOVE_PATH;
		/** 取注册 options（再认证凭据随请求一起发：会话本身不足以注册）。 */
		function fetchRegisterOptions(values, signal) {
			return fetch(REGISTER_OPTIONS_TARGET, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: encodeForm({
					label: values.label.trim(),
					password: values.password,
					code: values.code
				}),
				signal,
				credentials: "same-origin"
			});
		}
		/** 把 create 的结果与再认证凭据一起 POST 到 register。 */
		function postRegistration(values, credential, signal) {
			const response = credential.response;
			const request = {
				label: values.label.trim(),
				password: values.password,
				code: values.code,
				id: credential.id,
				client_data_json: encodeBase64Url(response.clientDataJSON),
				attestation_object: encodeBase64Url(response.attestationObject),
				transports: transportsOf(credential)
			};
			return fetch(REGISTER_TARGET, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: encodeForm(request),
				signal,
				credentials: "same-origin"
			});
		}
		/** options 请求失败 → 失败视图（`invalid_totp` 单独指向验证码框）。 */
		async function optionsFailure(res, t) {
			const body = await readJsonSafe$1(res);
			const failure = describePasskeyFailure(res.status, body, t);
			const totp = isInvalidTotp(res.status, body);
			return {
				kind: "failure",
				message: totp ? t(PASSKEY_KEYS.invalidTotp) : failure.message,
				fields: totp ? ["code"] : failure.fields
			};
		}
		/**
		* 注册一把新凭据：options（再认证）→ `navigator.credentials.create` → register。
		* 任一步失败都映射成同一种失败视图；用户取消/超时静默回退（`aborted`）。
		*/
		async function registerPasskey(values, signal, t) {
			if (!isPasskeySupported()) return { kind: "unsupported" };
			try {
				const optionsRes = await fetchRegisterOptions(values, signal);
				if (signal.aborted) return { kind: "aborted" };
				if (!optionsRes.ok) return await optionsFailure(optionsRes, t);
				const publicKey = toCreationOptions(await readJsonSafe$1(optionsRes));
				if (publicKey === void 0) return {
					kind: "failure",
					message: t(PASSKEY_KEYS.generic),
					fields: []
				};
				const credential = await navigator.credentials.create({ publicKey });
				if (signal.aborted) return { kind: "aborted" };
				if (credential === null) return { kind: "aborted" };
				const res = await postRegistration(values, credential, signal);
				if (signal.aborted) return { kind: "aborted" };
				if (res.ok) return { kind: "ok" };
				const body = await readJsonSafe$1(res);
				if (signal.aborted) return { kind: "aborted" };
				const failure = describePasskeyFailure(res.status, body, t);
				return {
					kind: "failure",
					message: failure.message,
					fields: failure.fields
				};
			} catch (error) {
				if (signal.aborted || isCancelled(error)) return { kind: "aborted" };
				return {
					kind: "failure",
					message: t(PASSKEY_KEYS.generic),
					fields: []
				};
			}
		}
		/**
		* 删除一把凭据（按 `idPrefix` 前缀唯一匹配）。再认证凭据随请求一起发：
		* 删最后一把时服务端会强制校验，普通单删也带上（同一份表单，不区分路径）。
		*
		* 第二个参数是 `PasskeyReauthValues`（只有口令与动态码），**不是**添加表单的
		* `PasskeyFormValues`：删除不该能读到添加表单的 label（评审 F6）。
		*/
		async function removePasskey(idPrefix, values, signal, t) {
			const request = {
				id: idPrefix,
				password: values.password,
				code: values.code
			};
			try {
				const res = await fetch(REMOVE_TARGET, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: encodeForm(request),
					signal,
					credentials: "same-origin"
				});
				if (signal.aborted) return { kind: "aborted" };
				if (res.ok) return { kind: "ok" };
				const body = await readJsonSafe$1(res);
				if (signal.aborted) return { kind: "aborted" };
				return {
					kind: "failure",
					failure: describePasskeyFailure(res.status, body, t)
				};
			} catch {
				return signal.aborted ? { kind: "aborted" } : {
					kind: "failure",
					failure: {
						message: t(PASSKEY_KEYS.generic),
						fields: []
					}
				};
			}
		}
		//#endregion
		//#region src/client/features/passkey/model/passkey-action-runners.ts
		/** 添加：本地校验已在调用方做过，这里只负责请求与结果落 UI。 */
		async function runAdd(values, context, callbacks) {
			const { t, lock, abort, mounted, setAdding, setFailure, setInvalid, setSuccess } = context;
			if (lock.current) return;
			lock.current = true;
			setAdding(true);
			context.clearFeedback();
			const controller = new AbortController();
			abort.current = controller;
			try {
				const result = await registerPasskey(values, controller.signal, t);
				if (!mounted.current || controller.signal.aborted) return;
				if (result.kind === "ok") {
					callbacks.setValues({
						label: "",
						password: "",
						code: ""
					});
					setSuccess(t(PASSKEY_KEYS.successAdd));
					context.onChanged();
					return;
				}
				if (result.kind === "unsupported") {
					setFailure({
						message: t(PASSKEY_KEYS.unsupported),
						fields: []
					});
					return;
				}
				if (result.kind === "failure") {
					setFailure({
						message: result.message,
						fields: result.fields
					});
					setInvalid(result.fields);
				}
			} catch {
				if (mounted.current && !controller.signal.aborted) setFailure({
					message: t(PASSKEY_KEYS.generic),
					fields: []
				});
			} finally {
				lock.current = false;
				if (mounted.current) setAdding(false);
			}
		}
		/** 删除：调用方已确认目标并校验过再认证值，这里只负责请求与结果落 UI。 */
		async function runRemove(idPrefix, values, context, callbacks) {
			const { t, lock, abort, mounted, setRemoving, setFailure, setInvalid, setSuccess } = context;
			if (lock.current) return;
			lock.current = true;
			setRemoving(idPrefix);
			context.clearFeedback();
			const controller = new AbortController();
			abort.current = controller;
			try {
				const result = await removePasskey(idPrefix, values, controller.signal, t);
				if (!mounted.current || controller.signal.aborted) return;
				if (result.kind === "ok") {
					callbacks.clearReauth();
					setSuccess(t(PASSKEY_KEYS.successRemove));
					context.onChanged();
					return;
				}
				if (result.kind === "failure") {
					setFailure(result.failure);
					setInvalid(result.failure.fields);
				}
			} catch {
				if (mounted.current && !controller.signal.aborted) setFailure({
					message: t(PASSKEY_KEYS.generic),
					fields: []
				});
			} finally {
				lock.current = false;
				if (mounted.current) setRemoving(null);
			}
		}
		//#endregion
		//#region src/client/features/passkey/model/use-passkey-actions.ts
		/**
		* 通行密钥的添加 / 删除状态机（重设计 2026-11-16）。
		*
		* 与改密同一套纪律：in-flight ref 硬锁（双击只发一次）、请求带 AbortController、
		* 卸载即 abort、回调里再看一眼 mounted，绝不卸载后 setState。
		*
		* 重设计的三处结构变化：
		* 1. **添加值与删除值分开**（`values` / `reauth`）。原来删除读的是添加表单的
		*    `values`，用户要删最后一把钥匙时得先在「添加通行密钥」里输密码（评审 F6）。
		* 2. **待删目标 `pendingRemove`**：点「删除」只设置它，不发请求；确认区展开后
		*    才由 `confirmRemove` 真正提交（评审：破坏性动作不能一次误点就执行）。
		* 3. **反馈互斥**：`failure` 与 `success` 不会同时有值，避免播报位读出矛盾结果。
		*/
		/** 添加表单的字段顺序（失败后聚焦第一个错误字段用）。 */
		const ADD_FIELD_ORDER = [
			"label",
			"password",
			"code"
		];
		/** 删除确认区的字段顺序。 */
		const REAUTH_FIELD_ORDER = ["password", "code"];
		/** 字段 id（与 passkey-fields.tsx / passkey-remove-form.tsx 的 id 同形）。 */
		function addFieldId(field) {
			return `dsh-auth-gate-passkey-${field}`;
		}
		/** 删除确认区的字段 id（与添加表单分开，避免同 id 冲突）。 */
		function reauthFieldId(field) {
			return `dsh-auth-gate-passkey-remove-${field}`;
		}
		/** 失败落点：有字段错误聚焦第一个，否则聚焦状态位。 */
		function focusFailure$1(view, order, idOf, statusId) {
			const first = order.find((field) => view.fields.includes(field));
			(first === void 0 ? document.getElementById(statusId) : document.getElementById(idOf(first)))?.focus();
		}
		/**
		* 反馈互斥：设失败就清成功，反之亦然。
		*
		* 原来 `failure` 与 `success` 是两个独立布尔，组件契约上允许同时有值，播报位会读出
		* 互相矛盾的结果（评审 F6）。这里把「一次操作只有一个结果」变成结构保证。
		*/
		function makeFeedback(deps) {
			return {
				fail: (view) => {
					deps.setFailure(view);
					if (view !== null) deps.setSuccess(null);
				},
				succeed: (text) => {
					deps.setSuccess(text);
					if (text !== null) deps.setFailure(null);
				},
				clearFeedback: () => {
					deps.setFailure(null);
					deps.setSuccess(null);
					deps.setInvalid([]);
				}
			};
		}
		/** 编辑阶段的四个动作：改添加值、改再认证值、请求删除、取消删除。 */
		function makeEditingActions(deps) {
			/** 编辑即清错：改正后红框不能还在。 */
			const clearField = (field) => {
				deps.setFailure(null);
				deps.setInvalid((previous) => previous.filter((item) => item !== field));
			};
			return {
				setValue: (field, value) => {
					deps.setValues((previous) => ({
						...previous,
						[field]: value
					}));
					clearField(field);
				},
				setReauthValue: (field, value) => {
					deps.setReauth((previous) => ({
						...previous,
						[field]: value
					}));
					clearField(field);
				},
				requestRemove: (idPrefix) => {
					deps.setReauth(() => EMPTY_PASSKEY_REAUTH);
					deps.setFailure(null);
					deps.setInvalid(() => []);
					deps.setPendingRemove(idPrefix);
				},
				cancelRemove: () => {
					deps.setPendingRemove(null);
					deps.setReauth(() => EMPTY_PASSKEY_REAUTH);
					deps.setFailure(null);
					deps.setInvalid(() => []);
				}
			};
		}
		/**
		* 添加与确认删除：先本地校验（失败聚焦第一个错误字段），再交给 runner 发请求。
		*
		* 抽成独立 hook 是为了让 `usePasskeyActions` 主体留在 80 行以内。
		*/
		function usePasskeySubmit(deps) {
			const { t, values, reauth, pendingRemove, context, fail, setInvalid } = deps;
			return {
				add: async () => {
					const problem = validatePasskeyForm(values, t);
					if (problem !== null) {
						fail(problem);
						setInvalid(problem.fields);
						focusFailure$1(problem, ADD_FIELD_ORDER, addFieldId, "dsh-auth-gate-passkey-status");
						return;
					}
					await runAdd(values, context, { setValues: deps.setValues });
				},
				confirmRemove: async () => {
					if (pendingRemove === null) return;
					const problem = validatePasskeyReauth(reauth, t);
					if (problem !== null) {
						fail(problem);
						setInvalid(problem.fields);
						focusFailure$1(problem, REAUTH_FIELD_ORDER, reauthFieldId, "dsh-auth-gate-passkey-status");
						return;
					}
					await runRemove(pendingRemove, reauth, context, { clearReauth: () => {
						deps.setReauth(EMPTY_PASSKEY_REAUTH);
						deps.setPendingRemove(null);
					} });
				}
			};
		}
		/**
		* 添加/删除的提交状态机。`onChanged` 在成功后调用（父组件用它刷新列表）。
		* 用户取消系统验证器（AbortError/NotAllowedError）静默回退：不显示错误、恢复按钮。
		*/
		function usePasskeyActions(t, onChanged) {
			const [values, setValues] = (0, react.useState)(EMPTY_PASSKEY_FORM);
			const [reauth, setReauth] = (0, react.useState)(EMPTY_PASSKEY_REAUTH);
			const [invalid, setInvalid] = (0, react.useState)([]);
			const [adding, setAdding] = (0, react.useState)(false);
			const [removing, setRemoving] = (0, react.useState)(null);
			const [pendingRemove, setPendingRemove] = (0, react.useState)(null);
			const [failure, setFailure] = (0, react.useState)(null);
			const [success, setSuccess] = (0, react.useState)(null);
			const lock = (0, react.useRef)(false);
			const abort = (0, react.useRef)(null);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
					abort.current?.abort();
				};
			}, []);
			const feedback = makeFeedback({
				setFailure,
				setSuccess,
				setInvalid
			});
			const context = {
				t,
				lock,
				abort,
				mounted,
				setAdding,
				setRemoving,
				setFailure: feedback.fail,
				setInvalid,
				setSuccess: feedback.succeed,
				clearFeedback: feedback.clearFeedback,
				onChanged
			};
			const editing = makeEditingActions({
				setValues,
				setReauth,
				setFailure,
				setInvalid,
				setPendingRemove
			});
			const submit = usePasskeySubmit({
				t,
				values,
				reauth,
				pendingRemove,
				context,
				fail: feedback.fail,
				setInvalid,
				setValues,
				setReauth,
				setPendingRemove
			});
			return {
				values,
				reauth,
				invalid,
				adding,
				removing,
				pendingRemove,
				failure,
				success,
				setValue: editing.setValue,
				setReauthValue: editing.setReauthValue,
				requestRemove: editing.requestRemove,
				cancelRemove: editing.cancelRemove,
				add: submit.add,
				confirmRemove: submit.confirmRemove,
				clearFeedback: feedback.clearFeedback
			};
		}
		//#endregion
		//#region src/client/features/passkey/api/passkey-list.ts
		/**
		* `GET /auth/passkey`：自己的凭据列表（M6 PR3）。
		*
		* 逐字段白名单解析：任一必需字段类型不符即丢弃该行，`passkeys` 不是数组则整表 failure。
		* 保持服务端顺序（createdAt 升序），client 不重排。
		*/
		const LIST_TARGET = PASSKEY_PATH;
		/** 单行形状校验：任一必需字段类型不符即丢弃该行（不整表失败）。 */
		function asSummary(value) {
			if (!isRecord$2(value)) return void 0;
			const { idPrefix, label, createdAt, lastUsedAt, backupEligible, backupState, transports } = value;
			if (typeof idPrefix !== "string" || idPrefix === "") return void 0;
			if (typeof label !== "string") return void 0;
			if (typeof createdAt !== "number" || typeof lastUsedAt !== "number") return void 0;
			if (typeof backupEligible !== "boolean" || typeof backupState !== "boolean") return void 0;
			if (!Array.isArray(transports)) return void 0;
			return {
				idPrefix,
				label,
				createdAt,
				lastUsedAt,
				backupEligible,
				backupState,
				transports: transports.filter((item) => typeof item === "string")
			};
		}
		/** 解析 200 body；`passkeys` 不是数组视为形状非法（整表 failure）。 */
		function parsePasskeyList(body) {
			if (!isRecord$2(body)) return void 0;
			const raw = body["passkeys"];
			if (!Array.isArray(raw)) return void 0;
			return raw.map(asSummary).filter((row) => row !== void 0);
		}
		/**
		* `GET /auth/passkey`：401 → `unauthorized`（登录态已死）；403 → `forbidden`（受限会话）；
		* 非 200 / 形状非法 / 网络抛错 → `failure`；中止 → `aborted`。
		*/
		async function fetchPasskeys(signal) {
			try {
				const res = await fetch(LIST_TARGET, {
					method: "GET",
					signal,
					credentials: "same-origin"
				});
				if (signal.aborted) return { kind: "aborted" };
				if (res.status === 401) return { kind: "unauthorized" };
				if (res.status === 403) return { kind: "forbidden" };
				if (!res.ok) return { kind: "failure" };
				const body = await readJsonSafe$1(res);
				if (signal.aborted) return { kind: "aborted" };
				const passkeys = parsePasskeyList(body);
				return passkeys === void 0 ? { kind: "failure" } : {
					kind: "ok",
					passkeys
				};
			} catch {
				return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
			}
		}
		//#endregion
		//#region src/client/features/passkey/model/use-passkey-list.ts
		/**
		* passkey 区块的列表状态机（M6 PR3）：挂载后拉一次，`reload` 供添加/删除成功后刷新。
		*
		* 与 `admin-block` 同一纪律：首拉失败才降级（刷新失败不改行），卸载即 abort。
		*/
		/** 挂载后拉一次列表；`reload` 供添加/删除成功后刷新。 */
		function usePasskeyList() {
			const [state, setState] = (0, react.useState)({ kind: "loading" });
			const [attempt, setAttempt] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let live = true;
				const first = attempt === 0;
				fetchPasskeys(controller.signal).then((result) => {
					if (!live || result.kind === "aborted") return;
					if (result.kind === "ok") setState({
						kind: "ok",
						passkeys: result.passkeys
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
		//#endregion
		//#region src/client/features/passkey/ui/passkey-block.tsx
		/**
		* 「通行密钥」区块（重设计 2026-11-16）。
		*
		* 结构：标题行（标题 + 数量徽标 + 添加按钮）+ 说明 + 列表（或空态）+ 状态播报位
		* + 按需展开的添加表单。添加与删除都默认收起：这两个动作一年用不了几次，常驻展开
		* 会把改密主任务挤出首屏（评审：低频表单不该和主任务抢空间）。
		*
		* 特性检测：`window.PublicKeyCredential` 不存在时**隐藏添加按钮**（列表照常显示，
		* 用户仍能看到/删除已有凭据）；无 JS 时整块不渲染（React 组件，本来就需要 JS）。
		*
		* 无权限（403 受限会话）时**不渲染添加与删除**：列表被禁止不代表添加被允许，
		* 让用户填一堆注定 403 的秘密信息是更糟的体验（评审 F5）。
		*/
		const TITLE_ID$2 = "dsh-auth-gate-passkey-title";
		/** 列表区：loading / 静默（受限会话）/ 错误 / 空态 / 表格。 */
		function PasskeyListArea({ t, state, removing, pendingRemove, onRequestRemove, renderConfirm, onRetry }) {
			if (state.kind === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: HINT_STYLE,
				children: t(PASSKEY_KEYS.loading)
			});
			if (state.kind === "forbidden") return null;
			if (state.kind === "unauthorized") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: ERROR_TEXT_STYLE,
				children: t(PASSKEY_KEYS.unauthorized)
			});
			if (state.kind === "failure") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 12
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: ERROR_TEXT_STYLE,
					children: t(PASSKEY_KEYS.unavailable)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					variant: "ghost",
					onClick: onRetry,
					children: t(PASSKEY_KEYS.retry)
				})]
			});
			if (state.passkeys.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasskeyTable, {
				t,
				passkeys: state.passkeys,
				removing,
				pendingRemove,
				onRequestRemove,
				renderConfirm
			});
		}
		/** 列表主体：空态 / 加载 / 错误 / 表格（含行内删除确认区）。 */
		function PasskeyBody({ t, state, actions, totpEnabled, onRetry }) {
			if (state.kind === "ok" && state.passkeys.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: EMPTY_STATE_STYLE,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: HINT_STYLE,
					children: t(PASSKEY_KEYS.empty)
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasskeyListArea, {
				t,
				state,
				removing: actions.removing,
				pendingRemove: actions.pendingRemove,
				onRequestRemove: actions.requestRemove,
				onRetry,
				renderConfirm: (passkey) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasskeyRemoveForm, {
					t,
					label: passkey.label,
					values: actions.reauth,
					invalid: actions.invalid,
					busy: actions.removing === passkey.idPrefix,
					totpEnabled,
					onChange: actions.setReauthValue,
					onCancel: actions.cancelRemove,
					onConfirm: actions.confirmRemove
				})
			});
		}
		/**
		* 通行密钥区块：列表 + 添加/删除。
		*
		* `supported` 在渲染期算一次（特性检测是纯读操作），不支持时只隐藏添加入口，
		* 列表与删除仍可用。
		*/
		function PasskeyBlock({ t, totpEnabled }) {
			const { state, reload } = usePasskeyList();
			const actions = usePasskeyActions(t, reload);
			const supported = isPasskeySupported();
			const [adding, setAdding] = (0, react.useState)(false);
			const addTriggerRef = (0, react.useRef)(null);
			/** 收起表单后要把焦点还给触发按钮；等渲染完成（按钮重新出现）再还。 */
			const returnFocusRef = (0, react.useRef)(false);
			const count = state.kind === "ok" ? state.passkeys.length : null;
			const isEmpty = state.kind === "ok" && state.passkeys.length === 0;
			const canMutate = state.kind === "ok";
			/**
			* 收起添加表单并把焦点还给触发按钮（键盘用户不丢位置）。
			*
			* 不能在这里直接 `focus()`：此刻 `adding` 还是 true，触发按钮还没渲染回来，
			* 拿到的 ref 是 null。标记一下，等 `adding` 变 false 的 effect 里再还。
			*/
			const closeAdd = () => {
				returnFocusRef.current = true;
				setAdding(false);
			};
			(0, react.useEffect)(() => {
				if (adding || !returnFocusRef.current) return;
				returnFocusRef.current = false;
				addTriggerRef.current?.focus();
			}, [adding]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: ADMIN_BLOCK_STYLE,
				"aria-labelledby": TITLE_ID$2,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: SECTION_HEADING_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							id: TITLE_ID$2,
							style: TITLE_STYLE,
							"aria-level": 2,
							children: t(PASSKEY_KEYS.title)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: SECTION_ACTIONS_STYLE,
							children: [count === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: ADMIN_BADGE_STYLE,
								children: t(PASSKEY_KEYS.count, { count })
							}), supported && canMutate && !adding ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								ref: addTriggerRef,
								variant: "ghost",
								"aria-expanded": false,
								onClick: () => setAdding(true),
								children: isEmpty ? t(PASSKEY_KEYS.emptyAction) : t(PASSKEY_KEYS.add)
							}) : null]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(PASSKEY_KEYS.intro)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasskeyBody, {
						t,
						state,
						actions,
						totpEnabled,
						onRetry: reload
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasskeyStatus, {
						failure: actions.failure,
						success: actions.success
					}),
					adding ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasskeyAddForm, {
						t,
						values: actions.values,
						invalid: actions.invalid,
						busy: actions.adding,
						totpEnabled,
						onChange: actions.setValue,
						onSubmit: actions.add,
						onCancel: closeAdd
					}) : null,
					supported ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(PASSKEY_KEYS.unsupported)
					})
				]
			});
		}
		//#endregion
		//#region src/client/features/passkey/api/passkey-settings.ts
		/**
		* 条件 UI 设置（admin）：`GET/POST /auth/passkey/settings`。
		*
		* 非 admin 的 403 映射成 `forbidden`：调用方据此**静默不渲染**开关（与 admin 块同一策略）。
		* 404 同样静默：`passkey: "off"` 时端点根本不注册，此时不该在面板上留一条「暂时不可用」。
		*/
		const SETTINGS_TARGET = PASSKEY_SETTINGS_PATH;
		/** 设置响应解析：只认 `{conditionalUiEnabled: boolean}`。 */
		function parseSettings(body) {
			if (!isRecord$2(body)) return { kind: "failure" };
			const enabled = body["conditionalUiEnabled"];
			return typeof enabled === "boolean" ? {
				kind: "ok",
				conditionalUiEnabled: enabled
			} : { kind: "failure" };
		}
		/** `GET /auth/passkey/settings`（admin）：403 → `forbidden`（非 admin 静默不渲染）。 */
		async function fetchPasskeySettings(signal) {
			try {
				const res = await fetch(SETTINGS_TARGET, {
					method: "GET",
					signal,
					credentials: "same-origin"
				});
				if (signal.aborted) return { kind: "aborted" };
				if (res.status === 403 || res.status === 404) return { kind: "forbidden" };
				if (!res.ok) return { kind: "failure" };
				const body = await readJsonSafe$1(res);
				if (signal.aborted) return { kind: "aborted" };
				return parseSettings(body);
			} catch {
				return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
			}
		}
		/** `POST /auth/passkey/settings`（admin）：写回条件 UI 开关（`"1"` / `"0"`）。 */
		async function updatePasskeySettings(enabled, signal) {
			const request = { conditionalUi: enabled ? "1" : "0" };
			try {
				const res = await fetch(SETTINGS_TARGET, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: encodeForm(request),
					signal,
					credentials: "same-origin"
				});
				if (signal.aborted) return { kind: "aborted" };
				if (res.status === 403 || res.status === 404) return { kind: "forbidden" };
				if (!res.ok) return { kind: "failure" };
				const body = await readJsonSafe$1(res);
				if (signal.aborted) return { kind: "aborted" };
				return parseSettings(body);
			} catch {
				return signal.aborted ? { kind: "aborted" } : { kind: "failure" };
			}
		}
		//#endregion
		//#region src/client/features/passkey/ui/passkey-settings-toggle.tsx
		/**
		* 条件 UI 开关（admin，M6 PR3）：登录页是否把 passkey 放进浏览器自动填充。
		*
		* 非 admin 的 403 静默不渲染（与 admin 块同一策略）；读写都走
		* `GET/POST /auth/passkey/settings`，写回成功后以服务端返回值为准（不乐观更新）。
		*/
		const TITLE_ID$1 = "dsh-auth-gate-passkey-settings-title";
		const TOGGLE_ID = "dsh-auth-gate-passkey-settings-toggle";
		/** 条件 UI 开关：读一次当前值，勾选即写回；失败保留原值并提示。 */
		function PasskeySettingsToggle({ t }) {
			const [state, setState] = (0, react.useState)({ kind: "loading" });
			const [saving, setSaving] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const abort = (0, react.useRef)(null);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				const controller = new AbortController();
				abort.current = controller;
				fetchPasskeySettings(controller.signal).then((result) => {
					if (!mounted.current || result.kind === "aborted") return;
					if (result.kind === "ok") setState({
						kind: "ok",
						enabled: result.conditionalUiEnabled
					});
					else if (result.kind === "forbidden") setState({ kind: "forbidden" });
					else setState({ kind: "failure" });
				});
				return () => {
					mounted.current = false;
					controller.abort();
				};
			}, []);
			const toggle = async (next) => {
				if (saving) return;
				setSaving(true);
				setMessage(null);
				setError(null);
				const controller = new AbortController();
				abort.current = controller;
				try {
					const result = await updatePasskeySettings(next, controller.signal);
					if (!mounted.current || result.kind === "aborted") return;
					if (result.kind === "ok") {
						setState({
							kind: "ok",
							enabled: result.conditionalUiEnabled
						});
						setMessage(t(PASSKEY_KEYS.settingsSaved));
						return;
					}
					setError(t(PASSKEY_KEYS.settingsError));
				} catch {
					if (mounted.current) setError(t(PASSKEY_KEYS.settingsError));
				} finally {
					if (mounted.current) setSaving(false);
				}
			};
			if (state.kind === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: HINT_STYLE,
				children: t(PASSKEY_KEYS.loading)
			});
			if (state.kind === "forbidden") return null;
			if (state.kind === "failure") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: ERROR_TEXT_STYLE,
				children: t(PASSKEY_KEYS.unavailable)
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: ADMIN_BLOCK_STYLE,
				"aria-labelledby": TITLE_ID$1,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						id: TITLE_ID$1,
						style: TITLE_STYLE,
						children: t(PASSKEY_KEYS.settingsTitle)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(PASSKEY_KEYS.settingsIntro)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						htmlFor: TOGGLE_ID,
						style: HINT_STYLE,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: TOGGLE_ID,
								type: "checkbox",
								checked: state.enabled,
								disabled: saving,
								onChange: (event) => void toggle(event.target.checked)
							}),
							" ",
							t(PASSKEY_KEYS.settingsLabel)
						]
					}),
					message === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: SUCCESS_TEXT_STYLE,
						children: message
					}),
					error === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: ERROR_TEXT_STYLE,
						children: error
					})
				]
			});
		}
		//#endregion
		//#region src/client/features/admin-users/lib/admin-copy.ts
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
			generic: "admin.generic",
			resetOpen: "admin.resetOpen",
			resetTitle: "admin.resetTitle",
			targetPassword: "admin.targetPassword",
			targetConfirm: "admin.targetConfirm",
			confirmTitle: "admin.confirmTitle",
			confirmWarning: "admin.confirmWarning",
			confirmSubmit: "admin.confirmSubmit",
			confirming: "admin.confirming",
			back: "admin.back",
			cancel: "admin.cancel",
			resetContext: "admin.resetContext",
			tableCaption: "admin.tableCaption",
			retry: "admin.retry"
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
			[ADMIN_KEYS.submit]: "检查重置",
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
			[ADMIN_KEYS.generic]: "重置失败，请稍后重试。",
			[ADMIN_KEYS.resetOpen]: "重置他人密码",
			[ADMIN_KEYS.resetTitle]: "为其他用户设置新密码",
			[ADMIN_KEYS.targetPassword]: "{name} 的新密码",
			[ADMIN_KEYS.targetConfirm]: "确认 {name} 的新密码",
			[ADMIN_KEYS.confirmTitle]: "确认重置 {name} 的密码？",
			[ADMIN_KEYS.confirmWarning]: "旧密码会立即失效；系统会尝试吊销 {name} 的所有会话。此操作不可撤销。",
			[ADMIN_KEYS.confirmSubmit]: "确认重置 {name} 的密码",
			[ADMIN_KEYS.confirming]: "正在重置 {name}...",
			[ADMIN_KEYS.back]: "返回修改",
			[ADMIN_KEYS.cancel]: "取消并清空",
			[ADMIN_KEYS.resetContext]: "目标：{name}。不会修改你的账号 {actor}。",
			[ADMIN_KEYS.tableCaption]: "实例用户列表",
			[ADMIN_KEYS.retry]: "重试"
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
			[ADMIN_KEYS.submit]: "Review reset",
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
			[ADMIN_KEYS.generic]: "Could not reset the password. Please try again later.",
			[ADMIN_KEYS.resetOpen]: "Reset another user's password",
			[ADMIN_KEYS.resetTitle]: "Set a new password for another user",
			[ADMIN_KEYS.targetPassword]: "New password for {name}",
			[ADMIN_KEYS.targetConfirm]: "Confirm the new password for {name}",
			[ADMIN_KEYS.confirmTitle]: "Reset {name}'s password?",
			[ADMIN_KEYS.confirmWarning]: "The old password stops working immediately, and the system will try to revoke all of {name}'s sessions. This cannot be undone.",
			[ADMIN_KEYS.confirmSubmit]: "Confirm reset for {name}",
			[ADMIN_KEYS.confirming]: "Resetting {name}...",
			[ADMIN_KEYS.back]: "Back to edit",
			[ADMIN_KEYS.cancel]: "Cancel and clear",
			[ADMIN_KEYS.resetContext]: "Target: {name}. Your account, {actor}, is unchanged.",
			[ADMIN_KEYS.tableCaption]: "Instance users",
			[ADMIN_KEYS.retry]: "Retry"
		};
		//#endregion
		//#region src/client/features/admin-users/lib/admin-failure.ts
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
		/** 错误码比较：码的字面量受契约（D31）约束，写错码编译不过；值本身仍是未校验的 `unknown`。 */
		function isError(value, code) {
			return value === code;
		}
		/** 规则列表：只保留字符串项，未知规则名原样回显（复用 account 的 `ruleText`）。 */
		function ruleList(value) {
			return Array.isArray(value) ? value.filter((rule) => typeof rule === "string") : [];
		}
		/** 400：`bad_target` / `policy`（携带 rules）；其余（含缺 error）→ generic。 */
		function describeBadRequest(error, rules, t) {
			if (isError(error, "policy")) return view(t(ADMIN_KEYS.policyIntro), ruleList(rules).map((rule) => ruleText(rule, t)), ["password"]);
			if (isError(error, "bad_target")) return view(t(ADMIN_KEYS.badTarget), [], ["target"]);
			return view(t(ADMIN_KEYS.generic));
		}
		/** 401：`invalid_totp` / `unauthorized`；其余 → generic。 */
		function describeUnauthorized(error, t) {
			if (isError(error, "invalid_totp")) return view(t(ADMIN_KEYS.invalidTotp), [], ["code"]);
			if (isError(error, "unauthorized")) return view(t(ADMIN_KEYS.unauthorized));
			return view(t(ADMIN_KEYS.generic));
		}
		/** 429：`locked` + 数字 retryAfter 插值，缺数字用无参文案；其余 → generic。 */
		function describeLocked(error, retryAfter, t) {
			if (!isError(error, "locked")) return view(t(ADMIN_KEYS.generic));
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
			const error = record.error;
			if (status === 400) return describeBadRequest(error, record.rules, t);
			if (status === 401) return describeUnauthorized(error, t);
			if (status === 403 && isError(error, "forbidden")) return view(t(ADMIN_KEYS.forbidden));
			if (status === 404 && isError(error, "not_found")) return view(t(ADMIN_KEYS.notFound), [], ["target"]);
			if (status === 429) return describeLocked(error, record.retryAfter, t);
			return view(t(ADMIN_KEYS.generic));
		}
		//#endregion
		//#region src/client/features/admin-users/api/admin-api.ts
		const USERS_TARGET = USERS_PATH;
		const RESET_TARGET = USERS_PASSWORD_PATH;
		/** 对象守卫：键按契约形状 `T` 读（读错键编译不过），值仍是未校验的 `unknown`。 */
		function isRecord(value) {
			return typeof value === "object" && value !== null;
		}
		/** 单行形状校验：任一必需字段类型不符即丢弃该行（不整表失败，契约 §1.2）。 */
		function asRow(value) {
			if (!isRecord(value)) return void 0;
			const { name, role, disabled, totpEnabled, mustChangePassword } = value;
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
			const raw = body.users;
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
			const request = {
				target: values.target,
				password: values.password,
				...options.actorTotpEnabled ? { code: values.code } : {}
			};
			return fetch(RESET_TARGET, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: encodeForm(request),
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
				if (res.status === 200 && body.ok === true) return {
					kind: "ok",
					sessionsRevoked: body.sessionsRevoked === true
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
		//#region src/client/features/admin-users/ui/admin-fields.tsx
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
				style: FIELD_ROW_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					htmlFor: id,
					style: FIELD_LABEL_STYLE,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: FIELD_CONTROL_STYLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id,
						name: field,
						type: isCode ? "text" : "password",
						value,
						autoComplete: isCode ? "one-time-code" : "new-password",
						inputMode: isCode ? "numeric" : void 0,
						"aria-invalid": invalid ? "true" : void 0,
						"aria-describedby": described.length === 0 ? void 0 : described.join(" "),
						style: invalid ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE,
						onChange: (event) => onChange(event.target.value)
					}), hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: hintId,
						style: HINT_STYLE,
						children: hint
					})]
				})]
			});
		}
		/** 状态区：失败消息 + 已翻译规则列表 + 就地成功/警告文案（契约 §3.8 / A8）。 */
		function AdminStatus({ failure, success }) {
			const warning = success?.warning === true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				id: ADMIN_STATUS_ID,
				role: "status",
				"aria-live": "polite",
				tabIndex: -1,
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
		//#region src/client/features/admin-users/ui/admin-reset-confirm.tsx
		/**
		* 重置他人密码的确认页（重设计 2026-11-16）。
		*
		* 为什么需要它：原来选错用户名直接执行，旧密码立即失效 + 会话吊销，是管理面最贵的
		* 可预防错误。确认页把「对谁做什么」和「不可逆后果」摆在同一个视野里，并要求显式点击。
		*
		* 安全细节：
		* - 安全动作（返回修改）在左，危险动作（确认重置）在右，避免双击同坐标完成破坏；
		* - 打开时焦点落在「返回修改」，不是危险按钮；
		* - 确认阶段按 Enter 不触发危险动作（Enter 只在编辑阶段推进到确认页）。
		*/
		/** 确认页：目标 + 后果 + 返回修改 / 确认重置。 */
		function AdminResetConfirm({ t, target, actorName, busy, onBack, onConfirm }) {
			const backRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				backRef.current?.focus();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: CONFIRM_PANEL_STYLE,
				role: "group",
				"aria-labelledby": "dsh-auth-gate-admin-confirm-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						id: "dsh-auth-gate-admin-confirm-title",
						style: CONFIRM_TITLE_STYLE,
						children: t(ADMIN_KEYS.confirmTitle, { name: target })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: CONFIRM_WARNING_STYLE,
						children: t(ADMIN_KEYS.resetContext, {
							name: target,
							actor: actorName
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: CONFIRM_WARNING_STYLE,
						children: t(ADMIN_KEYS.confirmWarning, { name: target })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: CONFIRM_ACTIONS_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							ref: backRef,
							variant: "ghost",
							onClick: onBack,
							disabled: busy,
							children: t(ADMIN_KEYS.back)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							variant: "danger",
							busy,
							onClick: () => void onConfirm(),
							children: busy ? t(ADMIN_KEYS.confirming, { name: target }) : t(ADMIN_KEYS.confirmSubmit, { name: target })
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/features/admin-users/model/admin-reset.ts
		/** 表单初值：提交成功后必须清回这一份（契约 §3.8）。 */
		const EMPTY_ADMIN_RESET = {
			target: "",
			password: "",
			confirm: "",
			code: ""
		};
		//#endregion
		//#region src/client/features/admin-users/model/admin-reset-hooks.ts
		/** 字段的文档顺序：失败后按这个顺序找第一个错误字段聚焦。 */
		const FIELD_ORDER = [
			"target",
			"password",
			"confirm",
			"code"
		];
		/** 状态播报位 id。 */
		const STATUS_ID = "dsh-auth-gate-admin-status";
		/** 字段 id（与 admin-fields.tsx 的 `adminFieldId` 同形；聚焦要用）。 */
		function fieldElementId(field) {
			return `dsh-auth-gate-admin-${field}`;
		}
		/** 失败落点：有字段错误聚焦第一个，否则聚焦状态位。 */
		function focusFailure(view) {
			const first = FIELD_ORDER.find((field) => view.fields.includes(field));
			(first === void 0 ? document.getElementById(STATUS_ID) : document.getElementById(fieldElementId(first)))?.focus();
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
		/**
		* 发一次重置请求并把结果归一成 `ResetOutcome`。
		*
		* 异常也在这里收口成 generic 失败，调用方不需要再写 try/catch。
		*/
		async function runReset(values, signal, options) {
			try {
				const result = await submitAdminReset(values, {
					signal,
					actorTotpEnabled: options.actorTotpEnabled
				}, options.t);
				if (result.kind === "ok") return {
					kind: "ok",
					sessionsRevoked: result.sessionsRevoked
				};
				if (result.kind === "aborted") return {
					kind: "failure",
					failure: {
						message: options.t(ADMIN_KEYS.generic),
						rules: [],
						fields: []
					}
				};
				return {
					kind: "failure",
					failure: result.failure
				};
			} catch {
				return {
					kind: "failure",
					failure: {
						message: options.t(ADMIN_KEYS.generic),
						rules: [],
						fields: []
					}
				};
			}
		}
		/**
		* 编辑阶段的四个动作：改值、检查（进确认页）、返回修改、取消并清空。
		*
		* 抽成独立 hook 是为了让 `useAdminReset` 主体留在 80 行以内；这里不持有状态，
		* 只把调用方的 setter 编排起来。
		*/
		function useResetEditing(deps) {
			const { values, t, actorTotpEnabled, lock } = deps;
			return {
				setValue: (field, value) => {
					deps.setValues({
						...values,
						[field]: value
					});
					deps.setFailure(null);
				},
				/** 第一次提交：只校验 + 进确认页，绝不发请求。 */
				review: () => {
					if (lock.current) return;
					const invalid = validateAdminReset(values, t, actorTotpEnabled);
					if (invalid !== null) {
						deps.setFailure(invalid);
						focusFailure(invalid);
						return;
					}
					deps.setFailure(null);
					deps.setSuccess(null);
					deps.setStage("confirm");
				},
				back: () => {
					deps.setStage("editing");
					deps.setFailure(null);
				},
				cancel: () => {
					deps.setValues({ ...EMPTY_ADMIN_RESET });
					deps.setStage("editing");
					deps.setFailure(null);
					deps.setSuccess(null);
				}
			};
		}
		/**
		* 确认页的显式确认：这里才真正发请求。
		*
		* 双锁（`lock`）+ abort + mounted 三重保护与改密/通行密钥同一套纪律。
		*/
		function useResetSubmit(deps) {
			const { values, t, actorTotpEnabled, lock, abort, mounted } = deps;
			return async () => {
				if (lock.current) return;
				lock.current = true;
				deps.setStage("submitting");
				deps.setFailure(null);
				deps.setSuccess(null);
				const controller = new AbortController();
				abort.current = controller;
				const live = () => mounted.current && !controller.signal.aborted;
				try {
					const outcome = await runReset(values, controller.signal, {
						t,
						actorTotpEnabled
					});
					if (!live()) return;
					if (outcome.kind === "ok") {
						deps.setSuccess(successView(outcome.sessionsRevoked, t));
						deps.setValues({ ...EMPTY_ADMIN_RESET });
						deps.onReset?.();
						return;
					}
					deps.setFailure(outcome.failure);
					focusFailure(outcome.failure);
				} finally {
					lock.current = false;
					if (mounted.current) deps.setStage("editing");
				}
			};
		}
		/** 表单事件处理：Enter 只在编辑阶段推进到确认页，确认阶段不触发危险动作。 */
		function useFormHandlers({ composing, stage, review }) {
			return {
				onSubmit: (event) => {
					event.preventDefault();
					if (composing.current) return;
					if (stage === "editing") review();
				},
				onKeyDown: (event) => {
					if (event.key !== "Enter") return;
					if (event.target instanceof HTMLSelectElement) return;
					event.preventDefault();
					if (composing.current || event.nativeEvent.isComposing === true) return;
					if (stage === "editing") review();
				}
			};
		}
		//#endregion
		//#region src/client/features/admin-users/model/use-admin-reset.ts
		/**
		* 重置他人密码的状态机（重设计 2026-11-16 从 `admin-form.tsx` 拆出）。
		*
		* 拆出来的原因：`admin-form.tsx` 已经 231 行，再加「确认阶段」会撞 250 行红线。
		*
		* 重设计的核心变化是**两阶段提交**：第一次提交只做本地校验并进入确认页，不发请求；
		* 用户在确认页看到「确认重置 {name} 的密码？」和不可逆后果，显式点确认才真正发请求。
		* 原来选错用户名直接执行，旧密码立即失效 + 会话吊销，是管理面最贵的可预防错误。
		*/
		/** 重置状态机：编辑 → 确认 → 提交，双锁 + abort + 卸载保护。 */
		function useAdminReset({ t, actorTotpEnabled, onReset }) {
			const [values, setValues] = (0, react.useState)(EMPTY_ADMIN_RESET);
			const [stage, setStage] = (0, react.useState)("editing");
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
			const editing = useResetEditing({
				values,
				t,
				actorTotpEnabled,
				lock,
				setValues,
				setStage,
				setFailure,
				setSuccess
			});
			const onCompositionStart = () => {
				composing.current = true;
			};
			const onCompositionEnd = () => {
				composing.current = false;
			};
			const confirm = useResetSubmit({
				values,
				t,
				actorTotpEnabled,
				lock,
				abort,
				mounted,
				setStage,
				setFailure,
				setSuccess,
				setValues,
				onReset
			});
			const handlers = useFormHandlers({
				composing,
				stage,
				review: editing.review
			});
			return {
				values,
				stage,
				failure,
				success,
				composing,
				setValue: editing.setValue,
				review: editing.review,
				back: editing.back,
				confirm,
				cancel: editing.cancel,
				onSubmit: handlers.onSubmit,
				onKeyDown: handlers.onKeyDown,
				onCompositionStart,
				onCompositionEnd
			};
		}
		//#endregion
		//#region src/client/features/admin-users/ui/admin-form.tsx
		/**
		* 重置他人密码的表单（重设计 2026-11-16：两阶段提交 + 行式布局）。
		*
		* 阶段由 `useAdminReset` 持有：`editing`（填表）→ `confirm`（确认页）→ `submitting`。
		* 这个组件只负责渲染当前阶段，不自己管状态机。
		*
		* 字段 id 是既有测试钉住的（`#dsh-auth-gate-admin-target/-password/-confirm/-code`），
		* 不能改；动态码是否渲染仍严格沿用 `actorTotpEnabled`。
		*/
		/** 目标下拉：排除本人（管理面不允许重置自己，契约 §3.6）。 */
		function TargetSelect({ t, targets, value, invalid, disabled, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: FIELD_ROW_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					htmlFor: adminFieldId("target"),
					style: FIELD_LABEL_STYLE,
					children: t(ADMIN_KEYS.target)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: FIELD_CONTROL_STYLE,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						id: adminFieldId("target"),
						name: "target",
						value,
						disabled,
						"aria-invalid": invalid ? "true" : void 0,
						"aria-describedby": invalid ? ADMIN_STATUS_ID : void 0,
						style: invalid ? ROW_INVALID_INPUT_STYLE : ROW_INPUT_STYLE,
						onChange: (event) => onChange(event.target.value),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: t(ADMIN_KEYS.targetPlaceholder)
						}), targets.map((user) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: user.name,
							children: user.name
						}, user.name))]
					})
				})]
			});
		}
		/** 管理重置表单：目标下拉（排除本人）+ 新口令 ×2 + 条件式动态码；成功后清空四字段、不跳转。 */
		function AdminResetForm({ t, users, actorName, actorTotpEnabled, onReset }) {
			const form = useAdminReset({
				t,
				actorTotpEnabled,
				onReset
			});
			const targets = users.filter((user) => user.name !== actorName);
			const isInvalid = (field) => form.failure?.fields.includes(field) === true;
			const targetInvalid = isInvalid("target");
			const target = form.values.target;
			if (form.stage === "confirm" || form.stage === "submitting") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminResetConfirm, {
				t,
				target,
				actorName,
				busy: form.stage === "submitting",
				onBack: form.back,
				onConfirm: form.confirm
			});
			const named = (key) => target === "" ? t(key) : t(key, { name: target });
			const fields = [
				{
					field: "password",
					label: named(ADMIN_KEYS.targetPassword)
				},
				{
					field: "confirm",
					label: named(ADMIN_KEYS.targetConfirm)
				},
				...actorTotpEnabled ? [{
					field: "code",
					label: t(ADMIN_KEYS.code)
				}] : []
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 8
				},
				noValidate: true,
				"aria-busy": false,
				onSubmit: form.onSubmit,
				onKeyDown: form.onKeyDown,
				onCompositionStart: form.onCompositionStart,
				onCompositionEnd: form.onCompositionEnd,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(ADMIN_KEYS.selfHint)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TargetSelect, {
						t,
						targets,
						value: form.values.target,
						invalid: targetInvalid,
						disabled: false,
						onChange: (value) => form.setValue("target", value)
					}), fields.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminTextField, {
						field: item.field,
						label: item.label,
						value: form.values[item.field],
						invalid: isInvalid(item.field),
						hint: item.field === "code" ? t(ADMIN_KEYS.codeHint) : void 0,
						hintId: item.field === "code" ? ADMIN_CODE_HINT_ID : void 0,
						onChange: (value) => form.setValue(item.field, value)
					}, item.field))] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(ADMIN_KEYS.policyHint)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminStatus, {
						failure: form.failure,
						success: form.success
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						type: "submit",
						children: t(ADMIN_KEYS.submit)
					})
				]
			});
		}
		//#endregion
		//#region src/client/widgets/account-section/ui/admin-block.tsx
		/**
		* 管理块（重设计 2026-11-16：固定外壳 + 重置入口默认收起）。
		*
		* 两处结构变化：
		* 1. **异步状态不再丢掉标题**。原来 loading / 401 / failure 时提前返回一条裸 Notice，
		*    「用户管理」标题和表格整体消失，状态变化会让页面跳动（评审 F8）。现在外壳
		*    （标题 + 说明）恒定渲染，只有内容区换状态。
		* 2. **重置表单默认收起**。它是低频且危险的动作，常驻展开会把用户表推下去；点
		*    「重置他人密码」就地展开，取消后焦点回触发按钮。
		*/
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
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("caption", {
						style: VISUALLY_HIDDEN_STYLE,
						children: t(ADMIN_KEYS.tableCaption)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
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
					] }) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: users.map((user) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
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
					] }, user.name)) })
				]
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
		/** 内容区：按列表状态切换（外壳恒定渲染，只有这里换）。 */
		function AdminBody({ t, state, actorName, actorTotpEnabled, resetting, onRetry, onReset, onCloseReset }) {
			if (state.kind === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminNotice, { text: t(ADMIN_KEYS.loading) });
			if (state.kind === "unauthorized") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminNotice, {
				text: t(ADMIN_KEYS.unauthorized),
				error: true
			});
			if (state.kind === "failure") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 12
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminNotice, {
					text: t(ADMIN_KEYS.unavailable),
					error: true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					variant: "ghost",
					onClick: onRetry,
					children: t(ADMIN_KEYS.retry)
				})]
			});
			if (state.kind !== "ok") return null;
			const targets = state.users.filter((user) => user.name !== actorName);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminUsersTable, {
					t,
					users: state.users,
					actorName
				}),
				targets.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					id: ADMIN_STATUS_ID,
					style: HINT_STYLE,
					children: t(ADMIN_KEYS.empty)
				}) : null,
				resetting ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminResetForm, {
					t,
					users: state.users,
					actorName,
					actorTotpEnabled,
					onReset
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					variant: "ghost",
					onClick: onCloseReset,
					children: t(ADMIN_KEYS.cancel)
				}) })] }) : null
			] });
		}
		/**
		* 管理块（契约 §3 / A2）：外壳恒定渲染，内容区按状态切换。
		* 「只有本人」时显示 `admin.empty` 且**不渲染重置入口**（§3.6）。
		*/
		function AdminUsersBlock({ t, actorName, actorTotpEnabled }) {
			const { state, reload } = useAdminUsers();
			const [resetting, setResetting] = (0, react.useState)(false);
			const resetTriggerRef = (0, react.useRef)(null);
			const returnFocusRef = (0, react.useRef)(false);
			/** 收起重置表单并把焦点还给触发按钮（等渲染完成再还）。 */
			const closeReset = () => {
				returnFocusRef.current = true;
				setResetting(false);
			};
			(0, react.useEffect)(() => {
				if (resetting || !returnFocusRef.current) return;
				returnFocusRef.current = false;
				resetTriggerRef.current?.focus();
			}, [resetting]);
			if (state.kind === "denied") return null;
			const targets = state.kind === "ok" ? state.users.filter((user) => user.name !== actorName) : [];
			const canReset = state.kind === "ok" && targets.length > 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 8
				},
				"aria-labelledby": TITLE_ID,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: SECTION_HEADING_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							id: TITLE_ID,
							style: TITLE_STYLE,
							children: t(ADMIN_KEYS.title)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: SECTION_ACTIONS_STYLE,
							children: canReset && !resetting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								ref: resetTriggerRef,
								variant: "ghost",
								"aria-expanded": false,
								onClick: () => setResetting(true),
								children: t(ADMIN_KEYS.resetOpen)
							}) : null
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: HINT_STYLE,
						children: t(ADMIN_KEYS.intro)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminBody, {
						t,
						state,
						actorName,
						actorTotpEnabled,
						resetting,
						onRetry: reload,
						onReset: reload,
						onCloseReset: closeReset
					})
				]
			});
		}
		//#endregion
		//#region src/client/entities/account/api/account-status.ts
		/** 会话探针（只认 cookie，语义同 `/auth/status`，契约 §1.1）。 */
		const STATUS_TARGET = STATUS_PATH;
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
		* `passkeyEnabled` 同理：旧服务端没有该键、或值不是布尔 → `undefined`（不推断为关闭）。
		*/
		function parseAccountStatus(body) {
			const source = typeof body === "object" && body !== null ? body : {};
			return {
				authenticated: source.authenticated === true,
				passkeyEnabled: optionalBoolean(source.passkeyEnabled),
				passwordLoginDisabled: optionalBoolean(source.passwordLoginDisabled),
				name: optionalString(source.name),
				role: optionalRole(source.role),
				disabled: optionalBoolean(source.disabled),
				totpEnabled: optionalBoolean(source.totpEnabled),
				sessionKind: optionalSessionKind(source.sessionKind)
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
		//#region src/client/widgets/account-section/ui/account-section.tsx
		/** 提示态 id：loading / 未登录共用一个 aria-live 播报位。 */
		const NOTICE_ID = "dsh-auth-gate-account-notice";
		/** 实例管理区的标题 id。 */
		const ADMIN_AREA_TITLE_ID = "dsh-auth-gate-admin-area-title";
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
		* passkey 区块渲染门：只有服务端明确报告 `passkeyEnabled === true` 才挂块。
		*
		* 三条理由：默认配置是 `passkey: "off"`（端点根本不存在，挂了只会拿到 404 并显示
		* 「暂时不可用」）；旧服务端没有该字段（`undefined` = 不知道，不推断为开启）；
		* 关闭时零请求，与「非 admin 不试拉管理面」同一纪律。
		*/
		function showsPasskeyBlock(status) {
			return status.passkeyEnabled === true;
		}
		/**
		* 「账户」设置页（`settings.section`）：未登录不给表单；已登录渲染自助改密表单，
		* 并在身份满足渲染门时（admin + 正式会话）追加管理块。`t` 缺失时降级到英文词典
		* （不显示键名），由 account-form / admin-block 承担各自的提交逻辑。
		*
		* 重设计（2026-11-16）的信息架构：**所有身份先看完全相同的「我的安全」自助区**
		* （账号上下文 + 改密 + 通行密钥），管理员只在后面追加一个「实例管理」区。
		* 不引入 tabs：管理员不是换一套页面，而是同一页面上多一段。
		*/
		function SettingsAccountSection({ t }) {
			const status = useAccountStatus();
			const translate = typeof t === "function" ? t : translateFrom({
				...ACCOUNT_DICT_EN,
				...ADMIN_DICT_EN
			});
			if (status === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Notice, { text: translate(ACCOUNT_KEYS.loading) });
			if (status.authenticated !== true) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Notice, { text: translate(ACCOUNT_KEYS.loginRequired) });
			const admin = showsAdminBlock(status);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountContext, {
					t: translate,
					name: status.name,
					role: status.role,
					totpEnabled: status.totpEnabled
				}),
				status.passwordLoginDisabled === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: HINT_STYLE,
					role: "status",
					children: translate(ACCOUNT_KEYS.passkeyOnlyNotice)
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountPasswordForm, {
					t: translate,
					totpEnabled: status.totpEnabled
				}),
				showsPasskeyBlock(status) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasskeyBlock, {
					t: translate,
					totpEnabled: status.totpEnabled
				}) : null,
				admin ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 12,
						marginTop: 8
					},
					"aria-labelledby": ADMIN_AREA_TITLE_ID,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: ADMIN_AREA_TITLE_ID,
							style: TITLE_STYLE,
							children: translate(ACCOUNT_KEYS.adminAreaTitle)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: HINT_STYLE,
							children: translate(ACCOUNT_KEYS.adminAreaIntro)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminUsersBlock, {
							t: translate,
							actorName: status.name,
							actorTotpEnabled: status.totpEnabled !== false
						}),
						showsPasskeyBlock(status) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasskeySettingsToggle, { t: translate }) : null
					]
				}) : null
			] });
		}
		//#endregion
		//#region src/client/features/logout/ui/logout-action.tsx
		/** 登出目标：POST-only（M22：next 仅从 query 取，校验回落 /）。 */
		const LOGOUT_TARGET = LOGOUT_URL;
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
				fetch(STATUS_PATH).then((res) => res.json()).then((body) => {
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
					fetch(STATUS_PATH).then((res) => res.json()).then((body) => {
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