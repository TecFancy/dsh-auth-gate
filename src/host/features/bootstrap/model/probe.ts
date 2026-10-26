import { loadUsersFile } from "../../../entities/user/index.js";

/**
 * 实例是否已经配置（首次引导的唯一判据）。每次引导请求现算，不缓存、不冻结：
 * 向导刚写完、或运维手工补上凭据后，引导窗口必须立刻关闭。
 */
export type ConfiguredState = "unconfigured" | "configured" | "unknown";

export interface ConfiguredProbeDeps {
  mode: "token" | "password";
  /** token 模式的凭证解析器（缺席 = 无可用解析器，按 unknown 处理）。 */
  resolveToken?: (() => Promise<string | undefined>) | undefined;
  /** password 模式的 `users.yaml` 路径。 */
  usersPath: string;
  /** 进程内标志：向导成功写入后置 true，此后一律 configured（服务端缓存不再延后关窗）。 */
  markedConfigured: { value: boolean };
}

export interface ConfiguredProbe {
  /** 现读一次：`configured` 与 `unknown` 都按「不引导」处理（fail-closed）。 */
  state(): Promise<ConfiguredState>;
  markConfigured(): void;
}

/**
 * 未配置探针。
 *
 * - token 模式：调用方**必须**传严格读取器，解析器给出空值 → `unconfigured`；非空 →
 *   `configured`；读取器缺席或抛错 → `unknown`。不要把 `makeTokenResolver` 传进来：它把
 *   服务缺失与解析异常都吞成 `undefined`，会让读故障被误判成未配置；吞错语义只服务门自己。
 * - password 模式：文件缺失或零用户 → `unconfigured`；有用户 → `configured`；读/解析/权限
 *   错误 → `unknown`。
 */
export function makeConfiguredProbe(deps: ConfiguredProbeDeps): ConfiguredProbe {
  return {
    async state(): Promise<ConfiguredState> {
      if (deps.markedConfigured.value) return "configured";
      try {
        return deps.mode === "password"
          ? await probePassword(deps.usersPath)
          : await probeToken(deps.resolveToken);
      } catch {
        return "unknown";
      }
    },
    markConfigured(): void {
      deps.markedConfigured.value = true;
    },
  };
}

async function probeToken(
  resolveToken: (() => Promise<string | undefined>) | undefined,
): Promise<ConfiguredState> {
  if (resolveToken === undefined) return "unknown";
  const token = await resolveToken();
  return token === undefined || token === "" ? "unconfigured" : "configured";
}

async function probePassword(usersPath: string): Promise<ConfiguredState> {
  const loaded = await loadUsersFile(usersPath);
  return loaded.missing || loaded.snapshot.users.size === 0 ? "unconfigured" : "configured";
}
