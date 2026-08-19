window.__ModuleLoader__.load({
	id: "dsh-auth-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/logout-action.tsx
		/** 登出按钮的可访问名（纯图标、无可见文字，按钮以 aria-label 命名）。 */
		const SIGN_OUT_LABEL = "Sign out";
		/** 登出目标：POST-only（M22：next 仅从 query 取，校验回落 /）。 */
		const LOGOUT_TARGET = "/auth/logout?next=/";
		/** 登出图标：16px，与对话头部工具栏（Session log）图标尺寸一致。 */
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
		* hover 态背景色：引用 shell 交互元素的 hover token
		* `var(--dsw-alias-interactive-bg-hover)`（浅色主题解析为 rgba(38, 49, 72, .06)，
		* 深色主题为 rgba(255, 255, 255, .08)），与 Session log / 图标按钮随主题一致。
		*/
		const HOVER_BACKGROUND = "var(--dsw-alias-interactive-bg-hover)";
		/** 与对话头部 Session log 按钮同一套 surface 语言：32px 圆形图标按钮。 */
		const BUTTON_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 32,
			height: 32,
			padding: 0,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: "50%",
			color: "var(--dsw-alias-label-primary)",
			cursor: "pointer",
			boxSizing: "border-box"
		};
		const formStyle = { display: "contents" };
		/**
		* 会话头部右上角的登出入口（conversation.session.header.utilities，session 作用域），
		* 纯图标。挂载时 fetch /auth/status 一次（只认 cookie），仅 authenticated:true 时
		* 渲染；登出走原生 form POST（零 JS 依赖，302 回落 / → 门禁 → 登录页）。
		*/
		function LogoutAction() {
			const [authenticated, setAuthenticated] = (0, react.useState)(null);
			const [hovered, setHovered] = (0, react.useState)(false);
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
			if (authenticated !== true) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("form", {
				method: "post",
				action: LOGOUT_TARGET,
				style: formStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "submit",
					"aria-label": SIGN_OUT_LABEL,
					title: SIGN_OUT_LABEL,
					style: {
						...BUTTON_STYLE,
						background: hovered ? HOVER_BACKGROUND : "transparent"
					},
					onMouseEnter: () => setHovered(true),
					onMouseLeave: () => setHovered(false),
					children: renderLogoutIcon()
				})
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* dsh-auth-gate client 半边：认证后在会话头部右上角（conversation.session.header.utilities，
		* session 作用域、可追加）挂一个纯图标登出入口。登出语义全部复用服务端冻结端点
		* （POST /auth/logout、GET /auth/status），本半边只负责渲染与门控。
		*/
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-auth-gate-logout",
				order: 10,
				label: "Sign out"
			}, LogoutAction));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map