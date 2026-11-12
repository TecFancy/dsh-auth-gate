/**
 * 管理端点单测的 HTTP 假件：请求构造（cookie + 表单体 + 同源头）与记录 header/status/body
 * 的假响应。与 `passkey-management-harness.ts` 分开，守 250 行文件上限。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { TEST_ORIGIN } from "./passkey-authenticator-harness.js";

/** 供测试构造请求体：把对象编码成 urlencoded。 */
export function formBody(fields: Record<string, string>): Buffer {
  return Buffer.from(new URLSearchParams(fields).toString());
}

/** 供测试构造请求：带 cookie + 表单体 + 同源头。 */
export function managementRequest(options: {
  method?: string;
  url: string;
  cookie?: string;
  body?: Buffer;
  contentType?: string;
  origin?: string | null;
}): IncomingMessage {
  const headers: Record<string, string | undefined> = {
    cookie: options.cookie,
    "content-type": options.contentType ?? "application/x-www-form-urlencoded",
  };
  if (options.origin !== null) headers["origin"] = options.origin ?? TEST_ORIGIN;
  return {
    method: options.method ?? "POST",
    url: options.url,
    headers,
    socket: { encrypted: false },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      if (options.body !== undefined) yield options.body;
    },
  } as unknown as IncomingMessage;
}

/** 假响应（与 `token-endpoints-harness` 的 `makeRes` 同形，但支持多次 set-cookie）。 */
export interface ManagementRes {
  readonly res: ServerResponse;
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

/** 造一个记录 header/status/body 的假响应。 */
export function makeManagementRes(): ManagementRes {
  const state = {
    status: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: "",
  };
  const res = {
    setHeader: (name: string, value: string): void => {
      state.headers[name.toLowerCase()] = value;
    },
    writeHead: (status: number, extra?: Record<string, string | number>): void => {
      state.status = status;
      for (const [name, value] of Object.entries(extra ?? {})) {
        state.headers[name.toLowerCase()] = String(value);
      }
    },
    end: (body?: string): void => {
      state.body = body ?? "";
    },
  } as unknown as ServerResponse;
  return Object.assign(state, { res });
}
