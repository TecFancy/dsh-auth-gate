import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
export const TELEMETRY_ENDPOINT = "https://t.hi-ruofei.com/v1/ping";
/** 本模块实现的契约版本。 */
export const TELEMETRY_VERSION = 1;
/** 同一进程两次上报的最小间隔：24 小时。 */
export const PING_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 一次上报的硬超时；超时只影响这次请求本身。 */
export const PING_TIMEOUT_MS = 5_000;
/** installId 写回的 settings 命名空间（= 插件名，与 profile 里的挂载行一致）。 */
const SETTINGS_NAMESPACE = "dsh-auth-gate";
/** 用户数分桶。`undefined` = 还没有可用的数字（本进程还没解析过 users.yaml），不猜。 */
export function usersBucket(count) {
    if (count === undefined || count <= 0)
        return undefined;
    if (count <= 1)
        return "1";
    if (count <= 5)
        return "2-5";
    return "6+";
}
/** 操作系统收窄到契约的封闭集合。 */
function hostOs(platform) {
    return platform === "linux" || platform === "darwin" || platform === "win32" ? platform : "other";
}
/** 架构收窄到契约的封闭集合。 */
function hostArch(arch) {
    return arch === "x64" || arch === "arm64" ? arch : "other";
}
/** 当前机器的报文事实。 */
function hostFacts() {
    return { nodeVersion: process.versions.node, platform: process.platform, arch: process.arch };
}
/** 读一次本包的 `package.json`（加载时）；源码与编译后的 lib/ 距包根同样四级。 */
function readPackageManifest() {
    try {
        const parsed = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return { pkg: "", version: "" };
        const record = parsed;
        const pkg = record["name"];
        const version = record["version"];
        return {
            pkg: typeof pkg === "string" ? pkg : "",
            version: typeof version === "string" ? version : "",
        };
    }
    catch {
        return { pkg: "", version: "" };
    }
}
/** 加载时读一次；读不到就不上报（宁可不报也不发半份报文）。 */
const MANIFEST = readPackageManifest();
/**
 * 组 v1 报文。
 *
 * 逐键构造而不是展开传入的对象，metrics 也在里面新建：调用方多塞的键不可能漏进请求。
 * @param input - 包的清单、id、metrics，以及可选的机器事实（测试用）。
 * @returns 可直接序列化的报文。
 */
export function buildPayload(input) {
    const host = input.host ?? hostFacts();
    return {
        v: TELEMETRY_VERSION,
        pkg: input.manifest.pkg,
        version: input.manifest.version,
        id: input.id,
        node: `v${host.nodeVersion.split(".")[0] ?? ""}`,
        os: hostOs(host.platform),
        arch: hostArch(host.arch),
        metrics: { mode: input.metrics.mode, totp: input.metrics.totp, users: input.metrics.users },
    };
}
/** POST 一份报文，超时由 {@link PING_TIMEOUT_MS} 中止。 */
async function postPayload(fetchFn, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
        await fetchFn(TELEMETRY_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * 匿名上报器。
 * @param options - 配置读取器、宿主的 settings 服务，以及注入的网络与时钟。
 * @returns 交给守卫放行钩子的对象。
 */
export function makeTelemetry(options) {
    const clock = options.now ?? Date.now;
    const fetchFn = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const enabled = options.enabled && MANIFEST.pkg.length > 0 && MANIFEST.version.length > 0;
    let lastPingAt = null;
    let currentId = null;
    let persisted = false;
    /** 把生成的 id 交回宿主写回；失败或没有服务时只在内存里用，下一次上报再试，绝不写文件。 */
    const rememberId = async (settings, id) => {
        if (settings === undefined)
            return;
        try {
            await settings.update(SETTINGS_NAMESPACE, { installId: id });
            persisted = true;
        }
        catch {
            // 契约要求静默；写失败不影响本次上报，也不影响下一次尝试。
        }
    };
    /** 生成一次、之后复用；配置里已有的 id 优先，且不再重写。 */
    const ensureId = async (settings) => {
        if (currentId !== null) {
            if (!persisted)
                await rememberId(settings, currentId);
            return currentId;
        }
        let stored = "";
        try {
            stored = options.installId().trim();
        }
        catch {
            // 读不到就按「没有 id」处理：下面生成一个新的，写回交给宿主。
        }
        if (stored.length > 0) {
            currentId = stored;
            persisted = true;
            return stored;
        }
        currentId = randomUUID();
        await rememberId(settings, currentId);
        return currentId;
    };
    /** 用户数：先用热路径已经解析出的数字，拿不到才走惰性兜底（一次上报至多读一次）。 */
    const usersNow = async () => {
        let count;
        try {
            count = options.users?.();
        }
        catch {
            count = undefined;
        }
        if (count !== undefined || options.readUsers === undefined)
            return count;
        try {
            return await options.readUsers();
        }
        catch {
            return undefined;
        }
    };
    /** 上报时的 metrics；用户数仍然未知时返回 undefined（这次不发）。 */
    const metricsNow = async () => {
        let users = "1";
        if (options.mode === "password")
            users = usersBucket(await usersNow());
        return users === undefined ? undefined : { mode: options.mode, totp: options.totp, users };
    };
    /** 一次上报；从 id 到 POST 全程吞错，放行它的请求早已返回。 */
    const send = async (settings) => {
        try {
            const metrics = await metricsNow();
            if (metrics === undefined)
                return;
            const id = await ensureId(settings);
            await postPayload(fetchFn, buildPayload({ manifest: MANIFEST, id, metrics }));
        }
        catch {
            // 契约要求静默：不重试、不记日志、不向放行它的请求抛出。
        }
    };
    return {
        enabled,
        noteAdmitted() {
            if (!enabled)
                return;
            try {
                const now = clock();
                if (lastPingAt !== null && now - lastPingAt < PING_INTERVAL_MS)
                    return;
                // 先占窗口：同一 tick 里被放行的两个请求不会各发一次（用户数的惰性读取要 await）。
                lastPingAt = now;
                // settings 缺席不是停用条件：id 留不住就每次重启换一个，服务端按 (id, 当天) 去重。
                void send(options.settings());
            }
            catch {
                // 坏的读取器或时钟同样不能影响已经放行的请求。
            }
        },
    };
}
//# sourceMappingURL=telemetry.js.map