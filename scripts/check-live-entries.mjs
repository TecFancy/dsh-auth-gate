#!/usr/bin/env node
/**
 * check-live-entries.mjs — 「升级后必跑」的入口覆盖回归（只读、无第三方依赖）。
 *
 * 背景：`src/gate/self-check.ts` 的 `assertGuarded()` 只检查"包装标记在不在"，
 * 不发真实请求。宿主 webServer 的路由表有四类入口（exact / prefix / upgrade /
 * fallback），标记在 ≠ 真的拦得住。本脚本用**未认证的真实请求**逐一验证。
 *
 * 两段式：
 *   1. 静态发现 — 扫描宿主依赖树里所有提到 `webServer` 的 JS 模块，解析
 *      `register({ kind, path })` / `registerUpgrade({ path })` /
 *      `registerFallback(handler)` 调用点（含 `const route = {...}` 间接与
 *      `captureLegacy(path, {...})` 包装形态），得到入口清单 + 来源包。
 *   2. 未认证实打 — 每个入口发一条**不带任何凭证**的探测请求：
 *        exact / prefix → HTTP GET，期望非 2xx（门返回 401；302 登录页也算通过）
 *        upgrade        → node:net 手写 WebSocket 握手，期望非 101（门返回 401）
 *        fallback       → 随机路径，期望非 2xx
 *
 * 只读保证：仅发 GET 探测与 WS 握手；不登录、不带 cookie/Authorization；
 * 不写宿主任何文件（本脚本只在 stdout 输出，`--markdown` 亦然）。
 *
 * 用法：
 *   node scripts/check-live-entries.mjs [--base http://127.0.0.1:3080]
 *       [--host-root /home/ubuntu/.dsh/profiles/web-prod-015/node_modules]
 *       [--timeout 5000] [--markdown] [--host-version 0.1.5-rc.2]
 *
 * 退出码：有任一 FAIL → 1（fail-closed：探测不到应答也算 FAIL）；否则 0。
 */
import crypto from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join, resolve, sep } from "node:path";

/** 线上宿主 profile 的依赖树（默认值；可用 --host-root 覆盖）。 */
const DEFAULT_HOST_ROOT = "/home/ubuntu/.dsh/profiles/web-prod-015/node_modules";
const DEFAULT_BASE = "http://127.0.0.1:3080";
const DEFAULT_TIMEOUT_MS = 5000;

const USAGE = `用法: node scripts/check-live-entries.mjs [选项]

  --base <url>        探测基址（默认 ${DEFAULT_BASE}）
  --host-root <dir>   宿主依赖树（默认 ${DEFAULT_HOST_ROOT}）
  --timeout <ms>      单次探测超时（默认 ${DEFAULT_TIMEOUT_MS}）
  --host-version <v>  覆盖输出里的宿主版本（默认取 @deepseek-ai/dsh-base 的版本）
  --markdown          表格改输出 Markdown（便于粘进证据文档）
  --discover-only     只做静态发现，不发任何请求
  -h, --help          显示本帮助

退出码: 任一入口未认证可达（HTTP 2xx / WS 101）或探测失败 → 1；否则 0。`;

/** 门自己的包名：它注册的 /auth/* 是**设计上公开**的入口，单独归类。 */
const GATE_PACKAGE = "dsh-auth-gate";

/**
 * 显式补充表：静态发现覆盖不到的入口，每条都注明来源与理由。
 * group=guarded → 未认证必须被拦（期望非 2xx）；group=public → 设计上公开必须可达。
 * kind 取值：exact | prefix | upgrade | fallback-probe | public。
 */
const SUPPLEMENTS = [
  {
    group: "guarded",
    kind: "fallback-probe",
    path: "/",
    source: "fallback seat owner @deepseek-ai/dsh-host-frontend-static",
    note: "SPA 根路径，线上验收基线（curl / → 401）；走 fallback 席位",
  },
  {
    group: "guarded",
    kind: "fallback-probe",
    path: "/index.html",
    source: "fallback seat owner @deepseek-ai/dsh-host-frontend-static",
    note: "fallback 静态服务直接命中的入口文件",
  },
  {
    group: "guarded",
    kind: "fallback-probe",
    path: "/favicon.ico",
    source: "fallback seat owner @deepseek-ai/dsh-host-frontend-static",
    note: "浏览器默认请求的真实路径，易被静态服务绕过",
  },
  // 下面 4 条是门自己注册的入口：静态发现刻意不认它们（注册走 `register: (route)
  // => server.register(route)` 包装，receiver 不叫 webServer），但它们**确实**占着
  // 宿主的 exact/prefix 表，且被门白名单放行——必须单独证明"公开是可控的"。
  {
    group: "public",
    kind: "public",
    path: "/auth",
    source:
      "dsh-auth-gate lib/features/password/password-endpoints.js:14 / token/auth-endpoints.js:15",
    expect: "404（/auth/* 兜底，不落 SPA）",
    note: "prefix 兜底：未注册的 /auth/* 一律 404",
  },
  {
    group: "public",
    kind: "public",
    path: "/auth/login",
    source: "dsh-auth-gate lib/features/password/password-endpoints.js:15（token 模式同名）",
    expect: "200（登录页）",
    note: "必须可达，否则无法登录",
  },
  {
    group: "public",
    kind: "public",
    path: "/auth/logout",
    source: "dsh-auth-gate lib/features/password/password-endpoints.js:17（token 模式同名）",
    expect: "405（仅 POST）",
    note: "GET 未认证不得 2xx",
  },
  {
    group: "public",
    kind: "public",
    path: "/auth/status",
    source: "dsh-auth-gate lib/features/password/password-endpoints.js:22（token 模式同名）",
    expect: "200（未认证态 JSON）",
    note: "只返回认证态，不含凭证",
  },
];

// ─────────────────────────── CLI ───────────────────────────

function parseArgs(argv) {
  const opts = {
    base: DEFAULT_BASE,
    hostRoot: DEFAULT_HOST_ROOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    markdown: false,
    hostVersion: "",
    discoverOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} 缺少取值`);
      i += 1;
      return value;
    };
    if (arg === "--base") opts.base = next();
    else if (arg === "--host-root") opts.hostRoot = next();
    else if (arg === "--timeout") opts.timeoutMs = Number(next());
    else if (arg === "--host-version") opts.hostVersion = next();
    else if (arg === "--markdown") opts.markdown = true;
    else if (arg === "--discover-only") opts.discoverOnly = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0)
    throw new Error("--timeout 必须是正数");
  return opts;
}

// ─────────────────── 最小词法工具（注释屏蔽 / 括号配平） ───────────────────

/** 从字符串字面量（含模板）起点跳到其结束后的下标；失败返回 -1。 */
function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && ch === "$" && text[i + 1] === "{") {
      const end = readBalanced(text, i + 1);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote !== "`" && (ch === "\n" || ch === "\r")) return -1;
    i += 1;
  }
  return -1;
}

/** 从 `(`/`{`/`[` 起配平到对应闭合符，返回闭合符下标；失败返回 -1。 */
function readBalanced(text, start) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(text, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** 把注释区域替换成等长空格（保留偏移量），字符串字面量原样保留。 */
function maskComments(text) {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(text, i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      const stop = nl < 0 ? text.length : nl;
      for (let k = i; k < stop; k += 1) out[k] = " ";
      i = stop;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const stop = close < 0 ? text.length : close + 2;
      for (let k = i; k < stop; k += 1) if (out[k] !== "\n") out[k] = " ";
      i = stop;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** 反转义一个普通字符串字面量的内容（路径场景足够；未知转义原样保留）。 */
function unescapeLiteral(inner) {
  return inner.replace(/\\(.)/g, (_, ch) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    return ch;
  });
}

// ─────────────────────────── 静态发现 ───────────────────────────

/** 收集文件级 `const NAME = "字面量"` 表（含 `export const`），用于解析 `path: NAME`。 */
function collectStringConsts(text) {
  const consts = new Map();
  const re =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  for (const match of text.matchAll(re)) {
    const value = resolveLiteral(match[2], consts);
    if (value !== undefined) consts.set(match[1], value);
  }
  return consts;
}

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g;
const constCache = new Map();

/**
 * 模块级字符串常量表：本文件的字面量 const + 沿相对 import 传递解析过来的
 * 具名导入（宿主 bundle 常把路径常量放进共享模块，如 `./shared.js`）。
 */
function moduleStringConsts(absFile, seen = new Set()) {
  if (constCache.has(absFile)) return constCache.get(absFile);
  if (seen.has(absFile)) return new Map();
  seen.add(absFile);
  let text;
  try {
    text = readFileSync(absFile, "utf8");
  } catch {
    return new Map();
  }
  const masked = maskComments(text);
  const consts = collectStringConsts(masked);
  for (const match of masked.matchAll(IMPORT_RE)) {
    const dep = resolve(join(absFile, "..", match[2]));
    const depConsts = moduleStringConsts(dep, seen);
    for (const spec of match[1].split(",")) {
      const parts = spec.trim().split(/\s+as\s+/);
      const exported = parts[0];
      const local = parts[1] ?? parts[0];
      if (exported === "" || local === "") continue;
      const value = depConsts.get(exported);
      if (value !== undefined && !consts.has(local)) consts.set(local, value);
    }
  }
  constCache.set(absFile, consts);
  return consts;
}

/** 解析一个字面量/标识符表达式为字符串；解析不了返回 undefined。 */
function resolveLiteral(raw, consts) {
  const text = raw.trim();
  if (text.startsWith('"') || text.startsWith("'")) {
    const end = skipString(text, 0);
    if (end !== text.length) return undefined;
    return unescapeLiteral(text.slice(1, -1));
  }
  if (text.startsWith("`")) {
    const end = skipString(text, 0);
    if (end !== text.length) return undefined;
    const inner = text.slice(1, -1);
    return inner.includes("${") ? undefined : unescapeLiteral(inner);
  }
  if (/^[A-Za-z_$][\w$]*$/.test(text)) return consts.get(text);
  return undefined;
}

/** 取对象字面量的顶层属性（key → 值原文）。 */
function objectProps(literal) {
  const props = new Map();
  const end = literal.length - 1;
  let i = 1;
  while (i < end) {
    while (i < end && /[\s,]/.test(literal[i])) i += 1;
    if (i >= end || literal[i] === "}") break;
    let key;
    if (literal[i] === '"' || literal[i] === "'") {
      const keyEnd = skipString(literal, i);
      if (keyEnd < 0) break;
      key = unescapeLiteral(literal.slice(i + 1, keyEnd - 1));
      i = keyEnd;
    } else {
      const match = /^[A-Za-z_$][\w$]*/.exec(literal.slice(i, end));
      if (match === null) {
        i += 1;
        continue;
      }
      key = match[0];
      i += match[0].length;
    }
    while (i < end && /\s/.test(literal[i])) i += 1;
    if (literal[i] !== ":") {
      const comma = literal.indexOf(",", i);
      if (comma < 0 || comma >= end) break;
      i = comma + 1;
      continue;
    }
    i += 1;
    while (i < end && /\s/.test(literal[i])) i += 1;
    const valueStart = i;
    let depth = 0;
    while (i < end) {
      const ch = literal[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        const strEnd = skipString(literal, i);
        if (strEnd < 0) break;
        i = strEnd;
        continue;
      }
      if (ch === "(" || ch === "{" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
      else if (ch === "," && depth === 0) break;
      i += 1;
    }
    props.set(key, literal.slice(valueStart, i).trim());
  }
  return props;
}

/** 收集文件里 `NAME = { ... }` 形式的对象字面量声明（用于间接 register(route)）。 */
function collectObjectVars(text) {
  const vars = new Map();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  for (const match of text.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const close = readBalanced(text, open);
    if (close < 0) continue;
    const list = vars.get(match[1]) ?? [];
    list.push({ at: match.index, literal: text.slice(open, close + 1) });
    vars.set(match[1], list);
  }
  return vars;
}

/** 取最近一次声明：优先调用点之前最近的，否则之后最近的。 */
function nearestObjectVar(decls, callIndex) {
  if (decls === undefined || decls.length === 0) return undefined;
  const before = decls.filter((entry) => entry.at < callIndex).at(-1);
  return before ?? decls[0];
}

/** 找出调用实参里的对象字面量（含被包装调用的实参），返回 {literal, pathHint}。 */
function findArgShape(argText) {
  const trimmed = argText.trim();
  const stringHints = [];
  const literals = [];
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(trimmed, i);
      if (end < 0) break;
      stringHints.push(trimmed.slice(i, end));
      i = end;
      continue;
    }
    if (ch === "`") {
      const end = skipString(trimmed, i);
      i = end < 0 ? trimmed.length : end;
      continue;
    }
    if (ch === "{") {
      const end = readBalanced(trimmed, i);
      if (end < 0) break;
      const literal = trimmed.slice(i, end + 1);
      const props = objectProps(literal);
      if (props.has("kind") || props.has("path")) literals.push({ literal, props });
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return { literals, stringHints };
}

/** 解析一个 register* 调用点 → 入口或"动态路径"记录。 */
function resolveCallSite({ method, argText, callIndex, consts, objectVars, file, pkg }) {
  if (method === "registerFallback") {
    return { kind: "fallback", path: "", raw: argText.trim().slice(0, 60), file, pkg };
  }
  const methodKind = method === "registerUpgrade" ? "upgrade" : undefined;
  const { literals, stringHints } = findArgShape(argText);
  let props;
  for (const candidate of literals) {
    if (candidate.props.has("path") || candidate.props.has("kind")) {
      props = candidate.props;
      break;
    }
  }
  if (props === undefined) {
    // 间接形态：register(route) → 找同名变量的对象字面量声明
    const ident = argText.trim().match(/^([A-Za-z_$][\w$]*)$/);
    if (ident !== null) {
      const decl = nearestObjectVar(objectVars.get(ident[1]), callIndex);
      if (decl !== undefined) props = objectProps(decl.literal);
    }
  }

  const kindRaw = props?.get("kind");
  const kind =
    kindRaw === undefined
      ? methodKind
      : (resolveLiteral(kindRaw, consts)?.replace(/^["']|["']$/g, "") ?? undefined);

  let path;
  let raw = "";
  const pathExpr = props?.get("path");
  if (pathExpr !== undefined) {
    raw = pathExpr;
    path = resolveLiteral(pathExpr, consts);
  }
  if (path === undefined && stringHints.length > 0) {
    raw = raw === "" ? stringHints[0] : raw;
    path = resolveLiteral(stringHints[0], consts);
  }
  if (path === undefined) {
    return {
      kind: kind ?? "unknown",
      dynamic: true,
      raw: raw === "" ? argText.trim().slice(0, 80) : raw,
      file,
      pkg,
    };
  }
  return { kind: kind ?? "exact", path, file, pkg };
}

const CALL_RE =
  /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*(register|registerUpgrade|registerFallback)\s*\(/g;
const ALIAS_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\.webServer\b/g;

/** 扫描单个模块文本，返回入口/动态记录数组。 */
function scanModule(text, file, pkg, consts) {
  const masked = maskComments(text);
  const objectVars = collectObjectVars(masked);
  const aliases = new Set([...masked.matchAll(ALIAS_RE)].map((match) => match[1]));
  const found = [];
  for (const match of masked.matchAll(CALL_RE)) {
    const receiver = match[1].replace(/\s+/g, "");
    const last = receiver.split(".").at(-1);
    const isWebServer =
      receiver.includes("webServer") || aliases.has(last) || aliases.has(receiver);
    if (!isWebServer) continue;
    const open = match.index + match[0].length - 1;
    const close = readBalanced(masked, open);
    if (close < 0) continue;
    const argText = masked.slice(open + 1, close);
    const line = masked.slice(0, match.index).split("\n").length;
    const entry = resolveCallSite({
      method: match[2],
      argText,
      callIndex: match.index,
      consts,
      objectVars,
      file,
      pkg,
    });
    found.push({ ...entry, line, receiver });
  }
  return found;
}

/** 递归收集候选模块（跳过测试与产物映射；只读）。 */
const SKIP_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "__mocks__",
  "coverage",
  "node_modules/.cache",
]);

function walkModules(dir, root, out) {
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name)) continue;
      if (dirent.name.startsWith(".")) continue;
      walkModules(full, root, out);
      continue;
    }
    if (!/\.(js|mjs|cjs)$/.test(dirent.name)) continue;
    if (/\.(test|spec)\./.test(dirent.name)) continue;
    out.push(full.slice(root.length + sep.length));
  }
}

/** 找到文件所属包的 package.json（最近的祖先）。 */
function packageOf(relFile, hostRoot) {
  const parts = relFile.split(sep);
  for (let depth = parts.length - 1; depth > 0; depth -= 1) {
    const manifest = join(hostRoot, ...parts.slice(0, depth), "package.json");
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, "utf8"));
        return { name: pkg.name ?? parts.slice(0, depth).join("/"), version: pkg.version ?? "" };
      } catch {
        return { name: parts.slice(0, depth).join("/"), version: "" };
      }
    }
  }
  return { name: parts[0], version: "" };
}

/** 静态发现：扫描依赖树里所有提到 webServer 的模块。 */
function discoverEntries(hostRoot) {
  const files = [];
  walkModules(hostRoot, hostRoot, files);
  const byKey = new Map();
  const dynamic = [];
  const scannedFiles = [];
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(hostRoot, rel), "utf8");
    } catch {
      continue;
    }
    if (!text.includes("webServer")) continue;
    scannedFiles.push(rel);
    const pkg = packageOf(rel, hostRoot);
    const consts = moduleStringConsts(join(hostRoot, rel));
    for (const entry of scanModule(text, rel, pkg.name, consts)) {
      const record = {
        kind: entry.kind,
        path: entry.path ?? "",
        source: pkg.name,
        version: pkg.version,
        file: `${rel}:${entry.line}`,
        raw: entry.raw ?? "",
      };
      if (entry.dynamic === true) {
        dynamic.push(record);
        continue;
      }
      const key = `${record.kind}|${record.path}`;
      const existing = byKey.get(key);
      if (existing === undefined) byKey.set(key, { ...record, files: [record.file] });
      else existing.files.push(record.file);
    }
  }
  return { entries: [...byKey.values()], dynamic, scannedFiles };
}

// ─────────────────────────── 未认证探测 ───────────────────────────

/** 未认证 HTTP GET（不带任何 cookie / Authorization）。 */
function probeHttp(base, path, timeoutMs, accept = "*/*") {
  return new Promise((resolveProbe) => {
    const url = new URL(path, base);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept, "user-agent": "dsh-auth-gate-entry-coverage/1" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (body.length < 200) body += chunk;
        });
        res.on("end", () =>
          resolveProbe({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? "",
            body: body.slice(0, 80).replace(/\s+/g, " ").trim(),
          }),
        );
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolveProbe({ error: error.message }));
    req.end();
  });
}

/** 未认证 WebSocket 升级握手（node:net 手写，不用 ws 库）。 */
function probeUpgrade(base, path, timeoutMs, extraHeaders = {}) {
  return new Promise((resolveProbe) => {
    const url = new URL(path, base);
    const socket = net.connect({
      host: url.hostname,
      port: Number(url.port === "" ? (url.protocol === "https:" ? 443 : 80) : url.port),
    });
    let buffer = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ error: "timeout" }));
    socket.on("connect", () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
        "Sec-WebSocket-Version: 13",
        `Origin: ${base}`,
        ...Object.entries(extraHeaders).map(([key, value]) => `${key}: ${value}`),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      const eol = buffer.indexOf("\r\n");
      if (eol < 0) return;
      const statusLine = buffer.slice(0, eol);
      const match = /^HTTP\/\d\.\d\s+(\d{3})/.exec(statusLine);
      finish({ status: match === null ? 0 : Number(match[1]), statusLine });
    });
    socket.on("error", (error) => finish({ error: error.code ?? error.message, raw: buffer }));
    socket.on("close", () => finish({ closed: true, raw: buffer }));
  });
}

/** 判定：exact/prefix/fallback 非 2xx 通过；upgrade 非 101 通过。 */
function judge(kind, probe) {
  if (probe.error !== undefined) return "FAIL";
  if (kind === "upgrade") return probe.status === 101 ? "FAIL" : "PASS";
  if (probe.status >= 200 && probe.status < 300) return "FAIL";
  return "PASS";
}

/**
 * 判定"设计上公开"的入口：必须真的可达（无错误、非 5xx），且不得被门自己拦成 401
 * ——白名单失效会让登录页也进不去。404/405 属端点自身语义，通过。
 */
function judgePublic(probe) {
  if (probe.error !== undefined) return "FAIL";
  if (probe.status === 401) return "FAIL";
  if (probe.status >= 500) return "FAIL";
  return "PASS";
}

/** 人类可读的响应摘要。 */
function describe(kind, probe) {
  if (probe.error !== undefined) return `ERROR ${probe.error}`;
  if (kind === "upgrade") {
    if (probe.status === 101) return "101 Switching Protocols";
    if (probe.status === 401) return "401 Unauthorized";
    if (probe.status > 0) return `${probe.status} ${probe.statusLine ?? ""}`.trim();
    return probe.closed === true ? "closed (无响应)" : "无响应";
  }
  if (probe.status === 302 && probe.location !== "") return `302 → ${probe.location}`;
  return String(probe.status);
}

/** 补充标注：升级探测里"无响应"= 宿主 upgrade 表里没有这条，属"不存在"而非"被拦"。 */
function noteFor(kind, probe, entry) {
  if (kind === "upgrade" && probe.status !== 101 && probe.status !== 401) {
    return probe.closed === true && probe.status === undefined
      ? "宿主 upgrade 表无此路径（socket 被销毁）"
      : "非 401 的非 101 响应，需人工确认";
  }
  if (kind === "fallback-probe") return entry.note ?? "";
  if (entry?.note !== undefined) return entry.note;
  return "";
}

// ─────────────────────────── 渲染与主流程 ───────────────────────────

function renderTable(rows, markdown) {
  const header = ["入口类型", "路径", "来源包", "未认证响应", "判定"];
  const body = rows.map((row) => [
    row.kind,
    row.path,
    row.source,
    row.observed,
    row.verdict === "PASS" && row.note !== "" ? `${row.verdict} (${row.note})` : row.verdict,
  ]);
  if (!markdown) {
    const widths = header.map((title, i) =>
      Math.max(title.length * 2, ...body.map((cells) => (cells[i] ?? "").length)),
    );
    const pad = (value, width) => value + " ".repeat(Math.max(0, width - value.length));
    const lines = [
      header.map((title, i) => pad(title, widths[i])).join(" | "),
      widths.map((width) => "-".repeat(width)).join("-|-"),
      ...body.map((cells) => cells.map((cell, i) => pad(cell ?? "", widths[i])).join(" | ")),
    ];
    return lines.join("\n");
  }
  const escape = (value) => String(value).replace(/\|/g, "\\|");
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((cells) => `| ${cells.map(escape).join(" | ")} |`),
  ].join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const hostRoot = resolve(opts.hostRoot);
  if (!existsSync(hostRoot)) throw new Error(`宿主依赖树不存在：${hostRoot}`);
  const startedAt = new Date();

  const { entries, dynamic, scannedFiles } = discoverEntries(hostRoot);
  if (opts.discoverOnly) {
    process.stdout.write(
      `扫描 ${scannedFiles.length} 个含 webServer 的模块，发现 ${entries.length} 条入口：\n`,
    );
    for (const entry of entries) {
      process.stdout.write(
        `  ${entry.kind.padEnd(8)} ${entry.path.padEnd(28)} ${entry.source}@${entry.version}  ← ${entry.files.join(", ")}\n`,
      );
    }
    process.stdout.write(`动态（未解析）${dynamic.length} 条：\n`);
    for (const entry of dynamic) {
      process.stdout.write(`  ${entry.kind} ${entry.raw} ← ${entry.source} (${entry.file})\n`);
    }
    return;
  }
  const manifestVersion = (name) => {
    const file = join(hostRoot, ...name.split("/"), "package.json");
    if (!existsSync(file)) return "";
    try {
      return JSON.parse(readFileSync(file, "utf8")).version ?? "";
    } catch {
      return "";
    }
  };
  const hostVersion = opts.hostVersion || manifestVersion("@deepseek-ai/dsh-base") || "unknown";
  const gateVersion = manifestVersion(GATE_PACKAGE) || "unknown";

  // 拆分：待验证入口 / 门自己公开的 /auth 端点 / 补充表
  const publicEntries = entries.filter((entry) => entry.source === GATE_PACKAGE);
  const guardedEntries = entries.filter((entry) => entry.source !== GATE_PACKAGE);
  const rows = [];
  for (const entry of guardedEntries) {
    const probe =
      entry.kind === "upgrade"
        ? await probeUpgrade(opts.base, entry.path, opts.timeoutMs)
        : await probeHttp(opts.base, entry.path, opts.timeoutMs);
    rows.push({
      kind: entry.kind,
      path: entry.path === "" ? "(fallback 席位：任意未注册路径)" : entry.path,
      source: `${entry.source}@${entry.version}`,
      observed: describe(entry.kind, probe),
      verdict: judge(entry.kind, probe),
      note: noteFor(entry.kind, probe, entry),
      files: entry.files,
    });
  }
  if (guardedEntries.some((entry) => entry.kind === "fallback")) {
    const randomPath = `/__entry-probe-${crypto.randomBytes(6).toString("hex")}__`;
    const probe = await probeHttp(opts.base, randomPath, opts.timeoutMs);
    rows.push({
      kind: "fallback",
      path: `${randomPath} (随机兜底探针)`,
      source: guardedEntries
        .filter((entry) => entry.kind === "fallback")
        .map((entry) => `${entry.source}@${entry.version}`)
        .join(", "),
      observed: describe("fallback", probe),
      verdict: judge("fallback", probe),
      note: "fallback 席位：任意未注册路径都不得 2xx",
      files: [],
    });
  }
  for (const supplement of SUPPLEMENTS.filter((entry) => entry.group === "guarded")) {
    const probe = await probeHttp(opts.base, supplement.path, opts.timeoutMs);
    rows.push({
      kind: supplement.kind,
      path: supplement.path,
      source: `${supplement.source} [补充表]`,
      observed: describe("fallback", probe),
      verdict: judge("fallback", probe),
      note: supplement.note,
      files: [],
    });
  }
  const publicRows = [];
  for (const entry of publicEntries) {
    const probe = await probeHttp(opts.base, entry.path, opts.timeoutMs);
    publicRows.push({
      kind: "public",
      path: entry.path,
      source: `${entry.source}@${entry.version} [门白名单 /auth/*，设计公开]`,
      observed: describe("exact", probe),
      verdict: judgePublic(probe),
      note: "认证端点本身必须可达（否则无法登录）",
      files: entry.files,
    });
  }
  for (const supplement of SUPPLEMENTS.filter((entry) => entry.group === "public")) {
    const probe = await probeHttp(opts.base, supplement.path, opts.timeoutMs);
    publicRows.push({
      kind: "public",
      path: supplement.path,
      source: `${supplement.source} [补充表]`,
      observed: describe("exact", probe),
      verdict: judgePublic(probe),
      note: `预期 ${supplement.expect}；${supplement.note}`,
      files: [],
    });
  }

  // 浏览器导航分支：Accept: text/html → 302 登录页（真实用户路径）
  const navProbe = await probeHttp(opts.base, "/", opts.timeoutMs, "text/html");
  const navRow = {
    kind: "fallback-probe",
    path: "/ (Accept: text/html)",
    source: "浏览器导航分支（同 fallback 席位）",
    observed: describe("fallback", navProbe),
    verdict: judge("fallback", navProbe),
    note: "浏览器导航应 302 → /auth/login?next=%2F",
    files: [],
  };

  const allRows = [...rows, navRow];
  const failed = [...allRows, ...publicRows].filter((row) => row.verdict === "FAIL");
  const finishedAt = new Date();
  const line = (text = "") => process.stdout.write(`${text}\n`);

  line("== dsh-auth-gate 入口覆盖回归（未认证实打，只读） ==");
  line(`时间    : ${startedAt.toISOString()} → ${finishedAt.toISOString()}`);
  line(`目标    : ${opts.base}（未认证；仅 GET / WS 握手）`);
  line(`宿主    : ${hostVersion}（@deepseek-ai/dsh-base；依赖树 ${hostRoot}）`);
  line(`门版本  : ${GATE_PACKAGE}@${gateVersion}`);
  line(`扫描    : ${scannedFiles.length} 个含 webServer 的模块`);
  line("");
  line(
    `发现入口: ${entries.length} 条（exact/prefix/upgrade/fallback），来自 ${new Set(entries.map((entry) => entry.source)).size} 个包`,
  );
  const perPackage = new Map();
  for (const entry of entries) {
    const key = `${entry.source}@${entry.version}`;
    perPackage.set(key, [...(perPackage.get(key) ?? []), entry]);
  }
  for (const [pkg, list] of [...perPackage.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const kinds = list.map((entry) => entry.kind).sort();
    line(`  - ${pkg}: ${list.length} 条 [${[...new Set(kinds)].join(", ")}]`);
  }
  line("");
  line("-- 未认证探测 --");
  line(renderTable(allRows, opts.markdown));
  line("");
  line("-- 门自己的公开端点（/auth 白名单，设计上不拦） --");
  line(renderTable(publicRows, opts.markdown));
  if (dynamic.length > 0) {
    line("");
    line(`-- 未能静态解析的动态入口 ${dynamic.length} 条（未探测，见文档「未覆盖」） --`);
    for (const entry of dynamic) {
      line(`  - ${entry.kind} ${entry.raw} ← ${entry.source} (${entry.file})`);
    }
  }
  line("");
  const passCount = allRows.filter((row) => row.verdict === "PASS").length;
  line(
    `结论: ${passCount}/${allRows.length} PASS，${failed.length} FAIL，${dynamic.length} 条动态入口未覆盖`,
  );
  if (failed.length > 0) {
    line("FAIL 明细:");
    for (const row of failed) line(`  - ${row.kind} ${row.path} → ${row.observed} (${row.source})`);
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`check-live-entries: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
