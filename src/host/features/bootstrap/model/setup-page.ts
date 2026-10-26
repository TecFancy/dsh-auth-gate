import { CARD_STYLE } from "../../../shared/login-page/index.js";
import { CONTINUE_PATH, LOGIN_PATH, SETUP_PATH } from "../../../shared/protocol/index.js";

/**
 * 首次配置向导的服务端渲染（英文，与登录页同一套卡片样式）。
 *
 * 页面里只出现配置摘要与表单，绝不渲染 launch token、也绝不渲染既有访问令牌；
 * 新生成的访问令牌只在 `setupResultHtml` 里出现一次。所有动态值一律 HTML-escape。
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** 向导页的少量补充样式（卡片骨架与配色全部来自登录页的 `CARD_STYLE`）。 */
const SETUP_STYLE = `
.card.wide{max-width:27rem}
.summary{margin:1.15rem 0 0;padding-top:1.15rem;border-top:1px solid var(--line);font-size:13px;line-height:20px;color:var(--muted)}
.summary dt{margin-top:10px;font-size:12px;font-weight:500;line-height:18px;color:var(--ink)}
.summary dd{margin:2px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.note{margin:12px 0 0;font-size:12px;line-height:18px;color:var(--muted)}
.token{margin:1.15rem 0 0;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--field)}
.token code{display:block;font:600 13px/20px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
`;

export interface SetupPageInput {
  mode: "token" | "password";
  tokenRef: string;
  cookieSecure: boolean;
  sessionTtl: number;
  usersPath: string;
  error?: string | undefined;
}

export interface SetupResultInput {
  token: string;
  /** true = 写盘成功但当前进程读不回来：重启 dsh 后它才成为唯一凭据。 */
  unreadable: boolean;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CARD_STYLE}${SETUP_STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** 配置摘要：告诉运营者当前生效的启动期设置，并指明要改得编辑哪个文件。 */
function summaryHtml(input: SetupPageInput): string {
  const rows: [string, string][] =
    input.mode === "token"
      ? [
          ["Mode", "token (one shared access token)"],
          ["Credential reference", input.tokenRef],
        ]
      : [
          ["Mode", "password (per-user accounts)"],
          ["Users file", input.usersPath],
        ];
  rows.push(["Cookie Secure flag", input.cookieSecure ? "on (HTTPS only)" : "off (plain HTTP)"]);
  rows.push(["Session lifetime", `${input.sessionTtl} seconds`]);
  const items = rows
    .map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  return `<dl class="summary">${items}</dl>
<p class="note">These are startup settings. To change them, edit <code>$DSH_HOME/cordis.patch.yml</code> and restart dsh.</p>`;
}

/** 模式相关的表单主体：token 模式只有一个按钮，password 模式是三个字段的建号表单。 */
function formBodyHtml(input: SetupPageInput): string {
  if (input.mode === "token") {
    return `<p class="hint">Create one access token for this instance. It is shown once, right after it is saved.</p>
<button type="submit">Generate access token</button>`;
  }
  return `<p class="hint">Create the first administrator account. Passwords need at least 14 characters with upper case, lower case, a digit and a symbol.</p>
<div class="field"><label for="username">Username</label><input id="username" type="text" name="username" autocomplete="username" placeholder="Administrator name" required autofocus spellcheck="false"></div>
<div class="field"><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="new-password" placeholder="At least 14 characters" required></div>
<div class="field"><label for="confirm">Confirm password</label><input id="confirm" type="password" name="confirm" autocomplete="new-password" placeholder="Repeat the password" required></div>
<button type="submit">Create administrator</button>`;
}

/** 向导页（GET，bootstrap 会话）。 */
export function setupPageHtml(input: SetupPageInput): string {
  const errorHtml =
    input.error === undefined
      ? ""
      : `<p class="error" id="err" role="alert">${escapeHtml(input.error)}</p>`;
  return page(
    "First run - dsh-auth-gate",
    `<main class="card wide">
<div class="head">
<h1 class="kicker">First run</h1>
<p class="host" dir="ltr">Set up this instance</p>
</div>
<form method="post" action="${SETUP_PATH}">
${errorHtml}${formBodyHtml(input)}
</form>
${summaryHtml(input)}
</main>`,
  );
}

/** token 模式的提交结果页：新令牌只在这里出现一次。 */
export function setupResultHtml(input: SetupResultInput): string {
  const unreadableHtml = input.unreadable
    ? `<p class="note">This process could not read the token back. Restart dsh so it becomes the only credential, and keep the token safe until then.</p>`
    : "";
  return page(
    "Access token - dsh-auth-gate",
    `<main class="card wide">
<div class="head">
<h1 class="kicker">Access token</h1>
<p class="host" dir="ltr">Saved</p>
</div>
<p class="hint">Copy this token now. It is shown once and cannot be recovered; if you lose it, overwrite or delete that entry in $DSH_HOME/.credentials.yaml (stored credentials take precedence over the environment) and restart dsh.</p>
<div class="token"><code>${escapeHtml(input.token)}</code></div>
${unreadableHtml}
<a class="back" href="${CONTINUE_PATH}">Continue to dsh</a>
</main>`,
  );
}

/** 已有正式会话访问向导：实例已经配置过，说明去哪儿。 */
export function setupConfiguredHtml(): string {
  return page(
    "Already configured - dsh-auth-gate",
    `<main class="card">
<div class="head">
<h1 class="kicker">Already configured</h1>
<p class="host" dir="ltr">Nothing to do</p>
</div>
<p class="hint">This instance already has credentials, so the first-run wizard is closed.</p>
<a class="back" href="/">Go to dsh</a>
<a class="back" href="${LOGIN_PATH}">Sign in</a>
</main>`,
  );
}
