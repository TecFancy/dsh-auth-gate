import type { PasskeySummaryView } from "./passkey-form.ts";
/** 列表四态：loading / unauthorized（登录态已死）/ forbidden（受限会话，静默）/ failure / ok。 */
export type PasskeyListState = {
    kind: "loading";
} | {
    kind: "unauthorized";
} | {
    kind: "forbidden";
} | {
    kind: "failure";
} | {
    kind: "ok";
    passkeys: PasskeySummaryView[];
};
/** 挂载后拉一次列表；`reload` 供添加/删除成功后刷新。 */
export declare function usePasskeyList(): {
    state: PasskeyListState;
    reload: () => void;
};
//# sourceMappingURL=use-passkey-list.d.ts.map