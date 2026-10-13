/**
 * 本地结构镜像（模式参考 dsh-better-sidebar 的 src/context-types.ts）：client
 * 半边只通过 cordis 服务协作，不 import 任何 @deepseek-ai/* 运行时值；类型在
 * 构建期擦除，bundle 只依赖平台模块表（react）。与上游运行时的漂移收敛在本文件。
 */

/** `ctx.slots.register` 的注册选项（本插件用到的子集）。 */
export interface AuthSlotRegisterOptions {
  /** 唯一槽位名（list map key），如 "settings.general.item"。 */
  name: string;
  /** list 槽位的 entry id：自用 id = 追加新格；复用 shipped id = 替换该格。 */
  id?: string;
  /** 同槽位内排列顺序，升序（默认 0）。 */
  order?: number;
  /** 投影文本；thunk 每次投影重读（本地化文案跟随语言切换）。 */
  label?: string | (() => string);
  /** 声明该 entry 文案的词典命名 `locale:` 命名一个 `auth` 域，注入 `t` 标准 seat。 */
  locale?: string;
}

/** client slots 服务面（镜像运行时 SlotRegistry）。 */
export interface AuthSlotsService {
  /** 注册一个槽位入口；disposer 已挂到调用方 fiber（卸载级联）。 */
  register(options: AuthSlotRegisterOptions, component: unknown): () => void;
  /** 槽位每次声明生命周期运行 callback;返回值幂等 disposer。 */
  inject(key: string, callback: () => () => void): () => void;
}

/**
 * 本地镜像的 locale 词典服务（运行时 LocaleRuntime 服务面）。未命名的词典
 * 按 (ns, locale) 分开注册；本插件不向 `LocaleNamespaceMap` 做编译期声明，
 * 这里走非类型化 `register(ns, locale, dict)` 路径。
 */
export interface AuthLocaleService {
  /** 注册一个命名词典的某一语言；返回 id 幂等 disposer。 */
  register(ns: string, locale: string, dict: Record<string, string>): () => void;
  /** 绑定命名词典为读取活动语言的 translate 函数。 */
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string;
}

/**
 * client 半边 cordis 上下文（本插件消费的服务面）。`effect` 与 `slots`/`locale`
 * 的 disposer 都挂在调用 fiber 上，插件卸载时级联清理。
 */
export interface AuthContext {
  slots: AuthSlotsService;
  locale: AuthLocaleService;
  effect(setup: () => (() => void) | Iterable<() => void>, label?: string): unknown;
}
