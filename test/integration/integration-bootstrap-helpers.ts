import {
  mountStack,
  unmountStack,
  type MountedStack,
  type MountStackOptions,
} from "./integration-auth-helpers.js";

/**
 * `integration.bootstrap.test.ts` 的共享夹具：真栈的生命周期、首跳断言与 cookie 提取。
 * 不是 `.test.ts`，所以 vitest 不收集它。
 */

/** 假 connection 里的 launch token（与 `mountStack` 的 authenticatedUrl 同值）。 */
export const LAUNCH = "launchTok-it";
/** 浏览器顶层文档导航的请求头。 */
export const NAVIGATION = { "sec-fetch-dest": "document" };
/** 表单提交的 content type。 */
export const FORM = "application/x-www-form-urlencoded";

export function baseUrl(stack: MountedStack): string {
  return `http://127.0.0.1:${stack.port}`;
}

/** 起真栈、跑用例、收栈（栈本身不关的话，storage 目录会留在临时目录里）。 */
export async function withStack<T>(
  options: MountStackOptions,
  body: (stack: MountedStack, base: string) => Promise<T>,
): Promise<T> {
  const stack = await mountStack(options);
  try {
    return await body(stack, baseUrl(stack));
  } finally {
    await unmountStack(stack.fibers, stack.root);
  }
}

/** 走完「launch URL → 引导端点」两跳，返回 bootstrap 会话 cookie。 */
export async function bootstrapCookie(base: string): Promise<string> {
  const hop = await fetch(`${base}/?token=${LAUNCH}`, { redirect: "manual" });
  const endpoint = await fetch(`${base}${hop.headers.get("location")!}`, { redirect: "manual" });
  if (endpoint.status !== 302) throw new Error(`bootstrap endpoint returned ${endpoint.status}`);
  return sessionCookie(endpoint);
}

/** `Set-Cookie` 的第一个 `name=value` 段（直接塞回 Cookie 头用）。 */
export function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0]!;
}
