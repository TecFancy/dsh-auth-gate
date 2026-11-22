import { describe, expect, it } from "vitest";
import { tmpPathFor, writeFileAtomic, type AtomicFileSystem } from "./atomic-write.js";

const TARGET = "/data/users.yaml";

interface Behaviour {
  failWrite?: boolean;
  failRename?: boolean;
  failDirectorySync?: boolean;
}

interface FakeFs {
  fs: AtomicFileSystem;
  events: string[];
}

/** 记录 open/write/sync/close/rename/rm 顺序的假 fs（不碰真实磁盘）。 */
function makeFakeFs(behaviour: Behaviour = {}): FakeFs {
  const events: string[] = [];
  let current = "";
  const fs: AtomicFileSystem = {
    open: (filePath) => {
      events.push(`open:${filePath}`);
      if (behaviour.failDirectorySync && !filePath.endsWith(".tmp")) {
        return Promise.reject(new Error("cannot open directory"));
      }
      current = filePath;
      return Promise.resolve({
        writeFile: (data) => {
          events.push(`write:${data}`);
          return behaviour.failWrite
            ? Promise.reject(new Error("write failed"))
            : Promise.resolve();
        },
        sync: () => {
          events.push(`sync:${current}`);
          return Promise.resolve();
        },
        close: () => {
          events.push(`close:${current}`);
          return Promise.resolve();
        },
      });
    },
    rename: (from, to) => {
      events.push(`rename:${from}->${to}`);
      return behaviour.failRename ? Promise.reject(new Error("rename failed")) : Promise.resolve();
    },
    rm: (filePath) => {
      events.push(`rm:${filePath}`);
      return Promise.resolve();
    },
  };
  return { fs, events };
}

function write(fs: AtomicFileSystem): Promise<void> {
  return writeFileAtomic(TARGET, "version: 1", { fs });
}

/** 本用例第一次 open 的 tmp 路径（唯一临时名）。 */
function tmpOf(events: string[]): string {
  return events[0]?.replace("open:", "") ?? "";
}

describe("tmpPathFor", () => {
  it("mints a unique same-directory temp name per call", () => {
    const first = tmpPathFor(TARGET);
    const second = tmpPathFor(TARGET);
    expect(first).not.toBe(second);
    expect(first.startsWith(`${TARGET}.`)).toBe(true);
    expect(first).toContain(`.${String(process.pid)}.`);
    expect(first.endsWith(".tmp")).toBe(true);
  });
});

describe("writeFileAtomic", () => {
  it("writes, fsyncs the temp file, renames, then fsyncs the directory", async () => {
    const { fs, events } = makeFakeFs();
    await write(fs);
    const tmp = tmpOf(events);
    expect(tmp).toMatch(/^\/data\/users\.yaml\.\d+\.[0-9a-f]{16}\.tmp$/);
    expect(events).toEqual([
      `open:${tmp}`,
      "write:version: 1",
      `sync:${tmp}`,
      `close:${tmp}`,
      `rename:${tmp}->${TARGET}`,
      "open:/data",
      "sync:/data",
      "close:/data",
    ]);
  });

  it("removes the writer's own temp file when the write fails", async () => {
    const { fs, events } = makeFakeFs({ failWrite: true });
    await expect(write(fs)).rejects.toThrow("write failed");
    expect(events).toContain(`rm:${tmpOf(events)}`);
    expect(events.some((event) => event.startsWith("rename:"))).toBe(false);
  });

  it("removes the writer's own temp file when the rename fails", async () => {
    const { fs, events } = makeFakeFs({ failRename: true });
    await expect(write(fs)).rejects.toThrow("rename failed");
    expect(events).toContain(`rm:${tmpOf(events)}`);
  });

  it("keeps the write when the platform cannot fsync the directory", async () => {
    const { fs, events } = makeFakeFs({ failDirectorySync: true });
    await expect(write(fs)).resolves.toBeUndefined();
    expect(events).toContain(`rename:${tmpOf(events)}->${TARGET}`);
    expect(events.some((event) => event.startsWith("rm:"))).toBe(false);
  });
});
