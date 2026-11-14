/**
 * passkey 区块的列表状态机（M6 PR3）：挂载后拉一次，`reload` 供添加/删除成功后刷新。
 *
 * 与 `admin-block` 同一纪律：首拉失败才降级（刷新失败不改行），卸载即 abort。
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
  | { kind: "ok"; passkeys: PasskeySummaryView[] };

/** 挂载后拉一次列表；`reload` 供添加/删除成功后刷新。 */
export function usePasskeyList(): { state: PasskeyListState; reload: () => void } {
  const [state, setState] = useState<PasskeyListState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const first = attempt === 0;
    void fetchPasskeys(controller.signal)
      .then((result) => {
        if (!live || result.kind === "aborted") return;
        if (result.kind === "ok") setState({ kind: "ok", passkeys: result.passkeys });
        else if (first) setState({ kind: result.kind });
      })
      .catch(() => {
        if (live && first) setState({ kind: "failure" });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);
  return { state, reload: () => setAttempt((value) => value + 1) };
}
