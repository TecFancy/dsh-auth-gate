/**
 * passkey 区块的列表状态机（M6 PR3）：挂载后拉一次，`reload` 供添加/删除成功后刷新。
 *
 * 刷新失败**必须**落到 failure 态（C3）：否则失败的重拉是无操作，界面会拿旧列表
 * 配「成功」播报，重试按钮也只改 attempt 不改变可见状态。卸载即 abort。
 */
import { useEffect, useState } from "react";
import { fetchPasskeys } from "../api/passkey-list.ts";
import type { PasskeySummaryView } from "./passkey-form.ts";

/** 列表四态：loading / unauthorized（登录态已死）/ forbidden（受限会话，静默）/ failure / ok。 */
export type PasskeyListState =
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "failure" }
  | { kind: "ok"; passkeys: PasskeySummaryView[]; refreshFailed?: boolean };

/** 挂载后拉一次列表；`reload` 供添加/删除成功后刷新。 */
export function usePasskeyList(): { state: PasskeyListState; reload: () => void } {
  const [state, setState] = useState<PasskeyListState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void fetchPasskeys(controller.signal)
      .then((result) => {
        if (!live || result.kind === "aborted") return;
        if (result.kind === "ok") setState({ kind: "ok", passkeys: result.passkeys });
        else if (result.kind === "unauthorized" || result.kind === "forbidden") {
          setState({ kind: result.kind });
        } else {
          // 刷新失败：保留最后一份可用列表与成功播报，只在旁边挂错误（C3/P2）。
          setState((previous) =>
            previous.kind === "ok" ? { ...previous, refreshFailed: true } : { kind: "failure" },
          );
        }
      })
      .catch(() => {
        if (!live) return;
        setState((previous) =>
          previous.kind === "ok" ? { ...previous, refreshFailed: true } : { kind: "failure" },
        );
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);
  return { state, reload: () => setAttempt((value) => value + 1) };
}
