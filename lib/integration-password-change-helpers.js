import { Context } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { apply, Config, inject, name } from "./index.js";
import { hashPassword } from "./features/password/index.js";
import { loadUsersFile, writeUsersFile } from "./shared/index.js";
/** 旧口令（种子）与新口令（满足 ≥14 + 四类字符策略）。 */
export const OLD_PASSWORD = "0ld-password-Aa1!";
export const NEW_PASSWORD = "N3w-password-Bb2@";
/** 11 字符，四类齐但不足 14：只触发 minLength。 */
export const SHORT_PASSWORD = "Sh0rt-pa!s";
async function waitFor(condition, timeoutMs = 5_000) {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeoutMs)
            throw new Error("timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}
/** 真实 HTTP 栈：Storage(json) + WebServer(随机端口) + 插件（password 模式）。 */
export async function mountPasswordChangeStack(options = {}) {
    const root = mkdtempSync(join(tmpdir(), "dsh-auth-pwchange-"));
    const usersFile = join(root, "users.yaml");
    await writeUsersFile(usersFile, {
        users: new Map([
            [
                "admin",
                {
                    passwordHash: await hashPassword(OLD_PASSWORD),
                    disabled: false,
                    ...(options.totpSecret === undefined ? {} : { totpSecret: options.totpSecret }),
                },
            ],
        ]),
    });
    const ctx = new Context();
    const fibers = [];
    fibers.push(await ctx.plugin(Storage));
    fibers.push(await ctx.plugin({
        name: storageJson.name,
        inject: storageJson.inject,
        apply: storageJson.apply,
        Config: storageJson.Config,
    }, { root }));
    fibers.push(await ctx.plugin({
        name: storageDomain.name,
        inject: storageDomain.inject,
        apply: storageDomain.apply,
        Config: storageDomain.Config,
    }, { backend: "json" }));
    fibers.push(await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 }));
    fibers.push(await ctx.plugin({ name, inject, apply, Config }, {
        mode: "password",
        cookieSecure: false,
        usersFile,
        totp: options.totp ?? "off",
    }));
    const server = ctx.get("webServer");
    server.register({
        kind: "exact",
        path: "/__probe",
        handler: (_req, res) => {
            res.writeHead(200);
            res.end("probe");
        },
    });
    await waitFor(() => ctx.get("auth").sessions !== undefined);
    return {
        ctx,
        port: server.port,
        fibers,
        root,
        usersFile,
        base: `http://127.0.0.1:${server.port}`,
    };
}
export async function unmountStack(stack) {
    for (const fiber of [...stack.fibers].reverse())
        await fiber.dispose();
    rmSync(stack.root, { recursive: true, force: true });
}
export async function login(base, password) {
    const res = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `username=admin&password=${encodeURIComponent(password)}`,
        redirect: "manual",
    });
    expect(res.status).toBe(302);
    return res.headers.get("set-cookie").split(";")[0];
}
export function changeBody(current, next, code) {
    const parts = [`current=${encodeURIComponent(current)}`, `password=${encodeURIComponent(next)}`];
    if (code !== undefined)
        parts.push(`code=${encodeURIComponent(code)}`);
    return parts.join("&");
}
export async function changePassword(base, cookie, body, method = "POST", extraHeaders = {}) {
    const res = await fetch(`${base}/auth/password`, {
        method,
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie,
            // P2 §6：写路径要求同源证明（fail-closed）。缺省模拟浏览器同源请求；
            // 需要断言拒绝矩阵时由 extraHeaders 显式覆盖成不带/伪造来源。
            "sec-fetch-site": "same-origin",
            ...extraHeaders,
        },
        ...(method === "GET" || method === "HEAD" ? {} : { body }),
        redirect: "manual",
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    }
    catch {
        json = undefined;
    }
    return { status: res.status, json, setCookie: res.headers.get("set-cookie"), text };
}
export async function stillAuthenticated(base, cookie) {
    const res = await fetch(`${base}/auth/status`, { headers: { cookie } });
    const body = (await res.json());
    return body.authenticated === true;
}
export async function storedHash(usersFile) {
    return (await loadUsersFile(usersFile)).snapshot.users.get("admin").passwordHash;
}
//# sourceMappingURL=integration-password-change-helpers.js.map