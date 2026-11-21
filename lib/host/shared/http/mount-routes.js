/**
 * 逆序释放全部 disposer。回滚阶段吞掉异常（首个 register 的原始错误更值得抛），
 * 正常卸载阶段则先摘完所有路由、最后把第一个异常抛出去：一个 disposer 抛错不能
 * 让后面的路由留在宿主表里。
 */
function disposeAll(disposers, swallow) {
    let firstError;
    for (const dispose of [...disposers].reverse()) {
        try {
            dispose();
        }
        catch (error) {
            if (swallow)
                continue;
            firstError ??= error;
        }
    }
    if (firstError !== undefined) {
        throw firstError instanceof Error ? firstError : new Error("route disposer failed");
    }
}
/**
 * 逐条注册路由并收集 disposer，返回合并 disposer（逆序释放）。
 *
 * 部分失败必须逐条回滚：`register` 一旦抛错，前面已经注册的路由仍在宿主表里，而它们的
 * disposer 还没被收集起来。直接向上抛会留下守卫指着已卸载插件的路由，重试还会撞
 * "duplicate route"（security.md §2 的逐条回滚纪律）。
 */
export function mountRoutes(register, routes) {
    const disposers = [];
    try {
        for (const route of routes)
            disposers.push(register(route));
    }
    catch (error) {
        disposeAll(disposers, true);
        throw error;
    }
    return () => disposeAll(disposers, false);
}
