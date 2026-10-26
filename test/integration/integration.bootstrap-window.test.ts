import { describe, expect, it } from "vitest";
import { loadUsersFile, writeUsersFile } from "../../src/host/entities/user/index.js";
import {
  bootstrapCookie,
  FORM,
  LAUNCH,
  NAVIGATION,
  withStack,
} from "./integration-bootstrap-helpers.js";

/**
 * 引导窗口的「关窗」真栈测试：配置一旦成立（凭据补齐、用户文件出现），已经签发的 bootstrap
 * 会话就不能再渲染向导、也不能再写盘；凭据服务缺失时探针只能给 unknown，窗口不许打开。
 */

/** 新装实例：没有配置，但凭据服务已经在位（解析为空 = 真未配置）。 */
const FRESH = {
  withCredentials: false,
  writableCredentials: true,
  connection: "authenticatedUrl",
} as const;
/** 连凭据服务都没有：探针只能给 unknown，引导窗口必须关着。 */
const NO_CREDENTIALS = { withCredentials: false, connection: "authenticatedUrl" } as const;

describe("integration: no window without a healthy credentials service", () => {
  it("10. refuses the launch URL while credentials are missing, then opens once they arrive", async () => {
    await withStack(NO_CREDENTIALS, async (stack, base) => {
      const blocked = await fetch(`${base}/auth/bootstrap?token=${LAUNCH}`, { redirect: "manual" });
      expect(blocked.status).toBe(302);
      expect(blocked.headers.get("location")).toBe("/auth/login?next=%2F");
      expect(blocked.headers.get("set-cookie")).toBeNull();

      // 凭据服务晚到（apply 之后才 provide）且解析为空 = 真未配置，窗口这时才该打开。
      const values = new Map<string, string>();
      stack.ctx.provide("credentials", {
        resolve: (ref: string) =>
          Promise.resolve(values.has(ref) ? { value: values.get(ref)! } : undefined),
        set: (ref: string, value: string) => {
          values.set(ref, value);
          return Promise.resolve();
        },
      });
      const opened = await fetch(`${base}/auth/bootstrap?token=${LAUNCH}`, { redirect: "manual" });
      expect(opened.status).toBe(302);
      expect(opened.headers.get("location")).toBe("/auth/setup");
      expect(opened.headers.get("set-cookie")).toContain("dsh_auth=");
    });
  });
});

describe("integration: the wizard closes when the instance becomes configured", () => {
  it("11. refuses both methods and keeps a pre-existing token intact", async () => {
    await withStack({ ...FRESH, publicHost: "dsh.example.com" }, async (stack, base) => {
      const cookie = await bootstrapCookie(base);
      // 运维用 CLI/手写文件补上了令牌：实例此刻已配置。
      stack.credentialsStore?.set("DSH_AUTH_TOKEN", "pre-existing-token");

      const page = await fetch(`${base}/auth/setup`, { headers: { cookie } });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Already configured");

      const post = await fetch(`${base}/auth/setup`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": FORM,
          origin: "http://dsh.example.com",
          ...NAVIGATION,
        },
        body: "",
        redirect: "manual",
      });
      expect(post.status).toBe(302);
      expect(post.headers.get("location")).toBe("/auth/login?next=%2F");
      expect(post.headers.get("set-cookie")).toBeNull();
      expect(stack.credentialsStore?.get("DSH_AUTH_TOKEN")).toBe("pre-existing-token");

      // 旧 bootstrap 会话已被吊销。
      const after = await fetch(`${base}/auth/setup`, { headers: { cookie }, redirect: "manual" });
      expect(after.status).toBe(302);
      expect(after.headers.get("location")).toBe("/auth/login?next=%2F");
    });
  });

  it("12. refuses to create a second administrator once users exist", async () => {
    await withStack(
      {
        withCredentials: false,
        mode: "password",
        connection: "authenticatedUrl",
        publicHost: "dsh.example.com",
      },
      async (stack, base) => {
        const cookie = await bootstrapCookie(base);
        await writeUsersFile(stack.usersFile, {
          users: new Map([
            ["existing", { passwordHash: "scrypt$1$2$3$4$hash", disabled: false, role: "admin" }],
          ]),
        });

        const page = await fetch(`${base}/auth/setup`, { headers: { cookie } });
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("Already configured");

        const post = await fetch(`${base}/auth/setup`, {
          method: "POST",
          headers: {
            cookie,
            "content-type": FORM,
            origin: "http://dsh.example.com",
            ...NAVIGATION,
          },
          body: new URLSearchParams({
            username: "root2",
            password: "Sup3r-secret-pw",
            confirm: "Sup3r-secret-pw",
          }).toString(),
          redirect: "manual",
        });
        expect(post.status).toBe(302);
        expect(post.headers.get("location")).toBe("/auth/login?next=%2F");
        expect(post.headers.get("set-cookie")).toBeNull();

        const loaded = await loadUsersFile(stack.usersFile);
        expect(loaded.snapshot.users.has("root2")).toBe(false);
        expect(loaded.snapshot.users.has("existing")).toBe(true);
      },
    );
  });
});
