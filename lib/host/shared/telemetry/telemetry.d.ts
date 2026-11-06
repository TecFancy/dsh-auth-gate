/**
 * 匿名使用统计：一次 ping，最多每进程每 24 小时一次，只在一次请求**已经被门放行之后**触发。
 *
 * 它只回答两个问题：有多少台机器真的在跑这个插件、跑的是哪个版本。答案是匿名的：没有账号、
 * 没有自己的服务器、没有第三方 SDK；离开机器的只有契约里那份固定键集的报文 - 包名与版本、
 * 一个随机 id、Node 主版本、平台、架构，以及本部署的三个事实（门模式、TOTP 模式、用户数分桶）。
 * 用户名、口令哈希、TOTP 密钥、会话 id、token、客户端 IP、请求路径、主机名一律不出现。
 *
 * 两条规则决定实现形状：**惰性** - 没有周期定时器、不在加载时调用，进程起来了但没人用就不上报；
 * 唯一的计时器是这一次请求自己的 5 秒中止信号。**静默** - 超时 5 秒、不重试、不写日志、不阻塞也
 * 不抛错到放行它的请求，所有失败都终止在这个文件里。
 *
 * 生成的 installId 经宿主的 settings 服务写回配置；宿主没有这个服务时 id 只留在内存里，
 * 每次重启换一个新的 - 仍然上报，但绝不退化到写一个私有文件。
 *
 * 网络与时钟可注入，用户数是读取器而不是值，所以测试既不需要 socket，也不需要真的等一天。
 */
/** 契约 v1 的上报端点（常量；不提供配置项）。 */
export declare const TELEMETRY_ENDPOINT = "https://t.hi-ruofei.com/v1/ping";
/** 本模块实现的契约版本。 */
export declare const TELEMETRY_VERSION = 1;
/** 同一进程两次上报的最小间隔：24 小时。 */
export declare const PING_INTERVAL_MS: number;
/** 一次上报的硬超时；超时只影响这次请求本身。 */
export declare const PING_TIMEOUT_MS = 5000;
/** users.yaml 已配置用户数的分桶，取值集合由契约固定。 */
export type UsersBucket = "1" | "2-5" | "6+";
/** 本包的固定 metrics：扁平的 string|number|boolean，键集不许临时增减。 */
export interface TelemetryMetrics {
    readonly mode: "token" | "password";
    readonly totp: "off" | "optional" | "required";
    readonly users: UsersBucket;
}
/** v1 报文：键集与另一个包共享的契约精确一致，多一个键都不行。 */
export interface TelemetryPayload {
    readonly v: number;
    readonly pkg: string;
    readonly version: string;
    readonly id: string;
    readonly node: string;
    readonly os: string;
    readonly arch: string;
    readonly metrics: TelemetryMetrics;
}
/** 本包的 `package.json` 身份；读不到时为空串，上报据此跳过。 */
export interface PackageManifest {
    readonly pkg: string;
    readonly version: string;
}
/** 本模块调用的 `fetch`；测试替换它，于是没有测试会打开 socket。 */
export type TelemetryFetch = (url: string, init: RequestInit) => Promise<unknown>;
/**
 * 宿主 settings 服务，只用到「把补丁合并进本插件的配置条目」这一项能力。
 *
 * 用它是为了给 installId 一个**唯一**的家：写回的就是加载时读的那份配置。私有的状态文件会是
 * 第二个家，两边第一次被手工编辑就会互相打脸；这个插件明确不这么做。
 */
export interface SettingsService {
    update(namespace: string, patch: object): Promise<void>;
}
/** 配置里的 volatile 字段：值是盒子不是值，经 `get()` 读当前快照。 */
export interface VolatileField<T> {
    get(): T;
}
/** 报文里的机器事实；先读出来再映射，映射本身可单测。 */
export interface HostFacts {
    readonly nodeVersion: string;
    readonly platform: string;
    readonly arch: string;
}
/** 本模块需要宿主半边提供的一切；能读的都写成读取器，用到时取当前值。 */
export interface TelemetryOptions {
    /** `telemetry` 配置项（默认 true）；false 时一次请求都不发。 */
    readonly enabled: boolean;
    /** 门模式，直接进 metrics。 */
    readonly mode: "token" | "password";
    /** TOTP 模式，直接进 metrics。 */
    readonly totp: "off" | "optional" | "required";
    /** 现读 installId；空串 = 还没生成过。 */
    readonly installId: () => string;
    /**
     * 宿主 settings 服务（惰性现取：harness 并行挂载行，服务可能晚于插件就绪）。
     * 缺席只意味着 id 留不住（本进程内存里那个照常用），日志照样上报；绝不退化到写文件。
     */
    readonly settings: () => SettingsService | undefined;
    /** 已经解析过的 users.yaml 用户数；省略或返回 undefined = 交给下面的惰性读取。 */
    readonly users?: () => number | undefined;
    /**
     * 用户数的惰性兜底：同步读取器给不出数字时，只在**上报真正到期**时读一次（至多每 24 小时
     * 一次），绝不在每个请求上读盘。省略 = 数字未知就不发这次上报。
     */
    readonly readUsers?: () => Promise<number | undefined>;
    /** 网络；缺省 `globalThis.fetch`。 */
    readonly fetch?: TelemetryFetch;
    /** 时钟（毫秒）；测试靠它把一天一步跨过去。 */
    readonly now?: () => number;
}
/** 调用方唯一需要的东西：告诉它一次请求被放行了。 */
export interface Telemetry {
    /** 整条上报是否启用（配置开着，且本包的 package.json 读得到）。 */
    readonly enabled: boolean;
    /**
     * 记一次「门放行了这次请求」。
     *
     * 立即返回：需要上报时在后台启动，不 await 网络，也绝不抛错，所以放行的请求不受影响。
     */
    noteAdmitted(): void;
}
/** 用户数分桶。`undefined` = 还没有可用的数字（本进程还没解析过 users.yaml），不猜。 */
export declare function usersBucket(count: number | undefined): UsersBucket | undefined;
/**
 * 组 v1 报文。
 *
 * 逐键构造而不是展开传入的对象，metrics 也在里面新建：调用方多塞的键不可能漏进请求。
 * @param input - 包的清单、id、metrics，以及可选的机器事实（测试用）。
 * @returns 可直接序列化的报文。
 */
export declare function buildPayload(input: {
    readonly manifest: PackageManifest;
    readonly id: string;
    readonly metrics: TelemetryMetrics;
    readonly host?: HostFacts;
}): TelemetryPayload;
/**
 * 匿名上报器。
 * @param options - 配置读取器、宿主的 settings 服务，以及注入的网络与时钟。
 * @returns 交给守卫放行钩子的对象。
 */
export declare function makeTelemetry(options: TelemetryOptions): Telemetry;
//# sourceMappingURL=telemetry.d.ts.map