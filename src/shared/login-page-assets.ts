/**
 * 登录页静态资源：共享 CSS、内联 SVG 与两段渐进增强脚本。与渲染逻辑分文件，
 * 让 `login-page.ts` 保持精简、样式预算（6KB）在此一处可见。
 *
 * 零第三方资源、无外部字体；脚本只做增强，无 JS 时表单照常提交。
 */

/**
 * 三变体共享样式：单栏「门禁检查点」卡（2026-09-22 grok-4.6 设计定稿）。
 * 身份块（kicker + 域名标记 + host）是反钓鱼核心：用户应在 3 秒内认出这是自己实例的
 * 门禁，而不是上游聊天产品的登录页。因此：不用上游品牌蓝、不放产品 logo、不用胶囊控件；
 * 域名是视觉主角（加粗大号 + 收字距 + bidi 隔离），顶/底用一层发丝分隔线分区，
 * 卡片靠一层柔和阴影悬浮。
 * 约束：零第三方资源、无外部字体、无 JS 也能提交、CSS 预算 6KB 内、深浅色 + 减少动效。
 */

export const CARD_STYLE = `
*,*::before,*::after{box-sizing:border-box}
:root{color-scheme:light dark;--bg:#eaedf2;--bg2:#dde2ea;--surface:#f6f7fa;--field:#fff;--ink:#1b1e24;--muted:#5c6370;--line:#d3d8e2;--ctl:#8a919e;--ctl-hover:#5c6573;--focus:#3d5a6c;--ring:rgba(61,90,108,.28);--danger:#b42318;--danger-bg:rgba(180,35,24,.07);--danger-ring:rgba(180,35,24,.22);--btn:#1b1e24;--btn-hover:#111318;--btn-active:#000;--btn-ink:#f6f7fa;--mark:rgba(61,90,108,.5);--wash:rgba(27,30,36,.06);--shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.08);--inset:inset 0 1px 2px rgba(15,23,42,.06);--ease:150ms cubic-bezier(.2,.7,.2,1)}
@media (prefers-color-scheme:dark){:root{--bg:#0c0d10;--bg2:#12141a;--surface:#1c1e24;--field:#14161b;--ink:#eeeef1;--muted:#9aa1ad;--line:#2e323c;--ctl:#8b919c;--ctl-hover:#c5cad3;--focus:#8aa4b3;--ring:rgba(138,164,179,.32);--danger:#f08880;--danger-bg:rgba(240,136,128,.1);--danger-ring:rgba(240,136,128,.28);--btn:#e8e9ed;--btn-hover:#d5d7de;--btn-active:#f4f5f7;--btn-ink:#1b1e24;--mark:rgba(138,164,179,.7);--wash:rgba(238,238,241,.08);--shadow:0 1px 2px rgba(0,0,0,.35),0 12px 36px rgba(0,0,0,.5);--inset:inset 0 1px 2px rgba(0,0,0,.4)}}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:linear-gradient(180deg,var(--bg),var(--bg2));color:var(--ink);font:400 15px/22px system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:22.5rem;padding:1.75rem 1.75rem 1.65rem;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}
.head{padding-bottom:1.15rem;border-bottom:1px solid var(--line)}
.kicker{margin:0;font-size:11px;font-weight:600;line-height:16px;letter-spacing:.12em;text-transform:uppercase;color:var(--focus)}
.host{margin:6px 0 0;font-size:22px;font-weight:700;line-height:28px;letter-spacing:-.025em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr;unicode-bidi:isolate}
.mark{display:inline-block;width:7px;height:7px;margin-right:9px;border-radius:1.5px;background:var(--mark);vertical-align:2px}
.who{margin:6px 0 0;font-size:13px;line-height:18px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
form{margin-top:1.15rem}
.hint{margin:0;font-size:13px;line-height:20px;color:var(--muted)}
.error{margin:0 0 12px;padding:8px 12px;border-left:3px solid var(--danger);border-radius:0 8px 8px 0;background:var(--danger-bg);color:var(--danger);font-size:13px;line-height:20px}
.field{margin-top:1.15rem}
.field+.field{margin-top:12px}
.hint+.field{margin-top:12px}
label{display:block;margin-bottom:6px;font-size:12px;font-weight:500;line-height:18px;color:var(--muted)}
input[type=text],input[type=password]{width:100%;height:44px;padding:0 12px;border:1px solid var(--ctl);border-radius:10px;background:var(--field);color:var(--ink);font:400 16px/22px system-ui,-apple-system,"Segoe UI",sans-serif;outline:none;box-shadow:var(--inset);transition:border-color var(--ease),box-shadow var(--ease),background-color var(--ease)}
input::placeholder{color:var(--ctl);opacity:1}
input:focus-visible{border-color:var(--focus);box-shadow:var(--inset),0 0 0 3px var(--ring)}
input[aria-invalid=true]{border-color:var(--danger)}
input[aria-invalid=true]:focus-visible{border-color:var(--danger);box-shadow:var(--inset),0 0 0 3px var(--danger-ring)}
input.code{text-align:center;font-variant-numeric:tabular-nums;letter-spacing:.35em;font-size:20px;padding-left:calc(12px + .35em)}
.pw{position:relative}
.pw input{padding-right:48px}
.eye{position:absolute;right:0;top:50%;transform:translateY(-50%);width:44px;height:44px;padding:0;border:0;border-radius:10px;background:none;color:var(--muted);cursor:pointer;display:grid;place-items:center;transition:color var(--ease),background-color var(--ease)}
.eye svg{display:block;width:18px;height:18px}
button[type=submit]{width:100%;height:44px;margin-top:18px;border:0;border-radius:10px;background:var(--btn);color:var(--btn-ink);font:600 15px/22px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;transition:background-color var(--ease),transform 120ms cubic-bezier(.2,.7,.2,1)}
button[type=submit]:disabled{opacity:.5;cursor:default}
button[type=submit]:focus-visible{outline:none;box-shadow:0 0 0 3px var(--ring)}
button[type=submit]:active{transform:scale(.985);background:var(--btn-active)}
.back{display:block;margin-top:4px;padding:13px 8px;text-align:center;font-size:13px;line-height:18px;color:var(--muted);text-decoration:none}
.meta{margin:1.15rem 0 0;padding-top:1.15rem;border-top:1px solid var(--line);text-align:center;font-size:12px;line-height:18px}
.meta a{color:var(--muted);text-decoration:none}
.eye:focus-visible{outline:none;color:var(--ink);box-shadow:0 0 0 3px var(--ring)}
.back:focus-visible,.meta a:focus-visible{outline:2px solid var(--focus);outline-offset:3px;border-radius:4px}
@media (hover:hover) and (pointer:fine){input[type=text]:hover,input[type=password]:hover{border-color:var(--ctl-hover)}input[aria-invalid=true]:hover{border-color:var(--danger)}.eye:hover{color:var(--ink);background:var(--wash)}button[type=submit]:hover{background:var(--btn-hover)}.back:hover,.meta a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}}
@media (max-width:359px){body{padding:16px}.card{padding:1.25rem 1rem 1.35rem;border-radius:10px}.host{font-size:18px;line-height:24px}input.code{letter-spacing:.25em}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important}button[type=submit]:active{transform:none}}
`;

export const EYE_OPEN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

export const EYE_CLOSED_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

/**
 * 密码可见切换（渐进增强：无 JS 时按钮无副作用，表单照常工作）。
 * 只依赖 data-toggle → 对应 input id；无第三方资源。
 */
export const EYE_SCRIPT = `
<script>
(function () {
  var buttons = document.querySelectorAll("[data-toggle]");
  for (var i = 0; i < buttons.length; i++) (function (btn) {
    btn.addEventListener("click", function () {
      var input = document.getElementById(btn.getAttribute("data-toggle"));
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      btn.querySelector(".eye-open").hidden = !show;
      btn.querySelector(".eye-closed").hidden = show;
    });
  })(buttons[i]);
})();
</script>
`;

/**
 * TOTP 自动提交（渐进增强：无 JS 时手输 + Verify 照常提交；Enter 原生提交）。
 * 只去非数字并截 6 位，满 6 位 lock 住按钮再交表单，避免双击重复提交。
 */
export const TOTP_SCRIPT = `
<script>
(function () {
  var code = document.getElementById("code");
  var form = code && code.form;
  if (!code || !form) return;
  var submit = form.querySelector('[type="submit"]');
  code.addEventListener("input", function () {
    code.value = code.value.replace(/[^0-9]/g, "").slice(0, 6);
    if (code.value.length === 6) {
      if (submit) submit.disabled = true;
      form.requestSubmit();
    }
  });
})();
</script>
`;
