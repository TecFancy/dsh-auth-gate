import { describe, expect, it } from "vitest";
import {
  getSetupPage,
  makeSetupHarness,
  postSetupForm,
  probeOf,
} from "../../../../../test/bootstrap-harness.js";

/**
 * 配置在 bootstrap 会话签发之后成立：向导的 GET/POST 都必须拒绝，且绝不写盘。
 * 这也是「bootstrap 会话能跨重启活 1 小时」的唯一安全兜底。
 */

const LOGIN_REDIRECT = "/auth/login?next=%2F";
const TRUSTED = { "sec-fetch-site": "same-origin" };
const NAVIGATION = { "sec-fetch-dest": "document" };

function cookieToken(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

describe("setup endpoints when the instance becomes configured", () => {
  it("shows the already-configured page and refuses the POST without writing", async () => {
    let saves = 0;
    let admins = 0;
    const harness = makeSetupHarness({
      mode: "token",
      probe: probeOf("configured"),
      saveToken: () => {
        saves += 1;
        return Promise.resolve({ status: "saved", token: "never-shown" });
      },
      createAdmin: () => {
        admins += 1;
        return Promise.resolve("ok");
      },
    });
    const cookie = await harness.cookie();
    const page = await getSetupPage(harness, cookie);
    expect(page.status).toBe(200);
    expect(page.body).toContain("Already configured");
    expect(page.body).not.toContain("Generate access token");

    const post = await postSetupForm(harness, {
      cookie,
      headers: { ...TRUSTED, ...NAVIGATION },
    });
    expect(post.status).toBe(302);
    expect(post.headers["location"]).toBe(LOGIN_REDIRECT);
    expect(post.headers["set-cookie"]).toBeUndefined();
    expect(harness.issued).toEqual([]);
    expect(saves).toBe(0);
    expect(admins).toBe(0);
    // 旧 bootstrap 会话被吊销：同一个 cookie 再来就进不去了。
    expect(harness.store.getByToken(cookieToken(cookie))).toBeUndefined();
  });

  it("refuses a non-navigation POST for both configured and unknown probes", async () => {
    for (const state of ["configured", "unknown"] as const) {
      const harness = makeSetupHarness({ probe: probeOf(state) });
      const page = await getSetupPage(harness, await harness.cookie());
      expect(page.status).toBe(200);
      expect(page.body).toContain("Already configured");
      const res = await postSetupForm(harness, { cookie: await harness.cookie() });
      expect(res.status).toBe(403);
      expect(res.body).toBe("already configured");
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });
});
