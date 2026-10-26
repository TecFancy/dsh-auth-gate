/**
 * bootstrap 功能片段的公共面（显式导出清单）：首次引导的探针、三个端点与服务端渲染页面。
 */
export { makeBootstrapEndpoint } from "./api/bootstrap-endpoint.js";
export type { BootstrapEndpointDeps } from "./api/bootstrap-endpoint.js";
export { makeContinueEndpoint } from "./api/continue-endpoint.js";
export type { ContinueEndpointDeps } from "./api/continue-endpoint.js";
export { makeSetupHandlers } from "./api/setup-endpoint.js";
export type { SetupEndpointDeps, SetupHandlers, SetupTokenOutcome } from "./api/setup-endpoint.js";
export { makeConfiguredProbe } from "./model/probe.js";
export type { ConfiguredProbe, ConfiguredProbeDeps, ConfiguredState } from "./model/probe.js";
export {
  setupConfiguredHtml,
  setupPageHtml,
  setupResultHtml,
  type SetupPageInput,
  type SetupResultInput,
} from "./model/setup-page.js";
