/**
 * 本地结构镜像（模式参考 dsh-better-sidebar 的 src/context-types.ts）：client
 * 半边只通过 cordis 服务协作，不 import 任何 @deepseek-ai/* 运行时值——类型在
 * 构建期擦除，bundle 只依赖平台模块表（react）。与上游运行时的漂移收敛在本文件。
 */
/** `ctx.slots.register` 的注册选项（本插件用到的子集）。 */
export interface AuthSlotRegisterOptions {
    /** 槽位名（slot map key），如 "conversation.session.header.utilities"。 */
    name: string;
    /** list 槽位的 entry id：自用 id = 追加新格；复用 shipped id = 替换该格。 */
    id?: string;
    /** 同槽位内排列顺序，升序（默认 0）。 */
    order?: number;
    /** 投影文本；thunk 每次投影重读（本地化文案跟随语言切换）。 */
    label?: string | (() => string);
}
/** client slots 服务面（镜像运行时 SlotRegistry）。 */
export interface AuthSlotsService {
    /** 注册一个槽位入口；disposer 已挂到调用方 fiber（卸载级联）。 */
    register(options: AuthSlotRegisterOptions, component: unknown): () => void;
    /** 槽位每次声明生命周期运行 callback（未声明则等声明后运行）；返回幂等 disposer。 */
    inject(key: string, callback: () => () => void): () => void;
}
/** client 半边 cordis 上下文（本插件消费的服务面）。 */
export interface AuthContext {
    slots: AuthSlotsService;
}
//# sourceMappingURL=context.d.ts.map