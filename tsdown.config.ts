import type { UserConfig } from "tsdown";

/**
 * dsh-auth-gate client 半边构建：src/client/index.tsx → lib/client.js
 * （window.__ModuleLoader__.load({ id, factory }) 格式，CJS closure）。
 * 复刻官方 DSH client-bundle 预设（参考 dsh-better-sidebar 的 tsdown 配置）：
 * - react / react/jsx-runtime 走模块表外部化（web app 提供），其余内联；
 * - 本插件不 import 任何 @deepseek-ai/* 运行时值（类型构建期擦除），
 *   故无需 purity gate 与 CSS 管线；
 * - 单文件产物（codeSplitting: false）。
 */
const CLIENT_EXTERNALS = ["react", "react/jsx-runtime"];

export default [
  {
    entry: { client: "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    dts: false,
    // 不发 sourcemap（E7）：npm tarball 只带 lib/、不带 src/，map 指向不存在的源文件，
    // 却占 310 KiB。需要调试时本地临时改回 true 即可。
    sourcemap: false,
    clean: false,
    external: CLIENT_EXTERNALS,
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] ?? "production"),
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    outputOptions: {
      entryFileNames: "client.js",
      banner: `window.__ModuleLoader__.load({ id: "dsh-auth-gate", factory: (require) => {`,
      footer: "return module.exports; } });",
      intro: "var module = { exports: {} }; var exports = module.exports;",
      codeSplitting: false,
    },
  },
] satisfies UserConfig[];
