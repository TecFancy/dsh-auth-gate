import type { UserRole } from "../../../shared/protocol/index.js";
import { renameWithRetry } from "./atomic-write.js";
import type { PasskeyRecord } from "./passkey-record.js";
import { UsersFileError, errorMessage } from "./users-file-error.js";
export { errorMessage, UsersFileError };
/** 用户名约束（P5）：字母/数字开头，可含 `._-`，总长 ≤ 64。匹配大小写敏感。 */
export declare const USERNAME_RE: RegExp;
/**
 * 预留用户名（大小写不敏感）：内部身份占用这些名字（引导会话 subject 等），
 * 新用户不得使用。已存在的历史同名用户仍可登录/改密（`loadUsersFile` 只用 `USERNAME_RE`）。
 */
export declare const RESERVED_USERNAMES: ReadonlySet<string>;
/**
 * **新建**用户名的统一校验：格式（`USERNAME_RE`）+ 非预留名（大小写不敏感）。
 * 创建路径（CLI `user add`、引导向导建首个管理员、`mutateUsersFile` 新增记录）共用；
 * 维护已有用户的路径继续用 `USERNAME_RE`，避免把历史同名用户锁在门外。
 */
export declare function isValidUsername(name: string): boolean;
/** 用户角色（契约 §3.1，定义在跨半边契约 D31）：`admin` 是唯一提权档位；YAML 缺省 `user`。 */
export type { UserRole };
export interface UserRecord {
    passwordHash: string;
    /** M3 只解析不使用（M4 TOTP）。 */
    totpSecret?: string;
    disabled: boolean;
    /** P1 新增；**可选**（loader 读时补 `user`）；写盘时 `user` 不落盘。 */
    role?: UserRole;
    /** P1 新增；**可选**（loader 读时补 `false`）；YAML 键 `must_change_password`，`false` 不落盘。 */
    mustChangePassword?: boolean;
    /**
     * 最近一次口令变更的时间（ISO-8601，含毫秒）；YAML 键 `password_changed_at`。
     * **可选**：老文件没有该键。会话扫描器据此吊销凭证版本更旧的会话（签发时记录该值）
     * 的会话行，使 CLI（独立进程、够不到会话存储）改的口令也在下一轮扫描生效。
     */
    passwordChangedAt?: string;
    /** base64url（解码 16–64 字节），首次注册时生成；不得含 username/邮箱等 PII。 */
    passkeyUserHandle?: string;
    /** 该用户的通行密钥；**可选**（loader 读时补 `[]`）；写盘时空数组不落盘。 */
    passkeys?: PasskeyRecord[];
}
export interface UsersSnapshot {
    users: Map<string, UserRecord>;
}
/** 加载结果：`missing` 区分"文件不存在"与"存在但无用户"（warn-once，P7）。 */
export interface UsersLoadResult {
    snapshot: UsersSnapshot;
    missing: boolean;
}
/** P6：DSH_HOME env → `~/.dsh` 兜底，拼 `auth/users.yaml`。CLI 与插件共享。 */
export declare function defaultUsersFilePath(): string;
/** 每次登录现读（P7）。ENOENT → `{ snapshot: 空, missing: true }`（不抛）。 */
export declare function loadUsersFile(filePath: string): Promise<UsersLoadResult>;
/** 用户名字典序（显式比较器（eslint 要求；locale 无关））。 */
export declare function compareNames(a: string, b: string): number;
/** CLI 用（P19）：全量序列化 + 同目录 `.tmp` + 原子替换 + 0600；目录自动创建。 */
export declare function writeUsersFile(filePath: string, snapshot: UsersSnapshot): Promise<void>;
/** 原子替换原语对测试暴露；实现见 `atomic-write.ts`。 */
export { renameWithRetry };
/**
 * 锁内 read-modify-write（契约 §3.2）：CLI 与端点的唯一变更入口。
 * mutator 内抛错 → 原样上抛（UsersFileError 保持类型）；锁内任何失败都释放锁。
 * **mutator 内不得再次调用 mutateUsersFile**（同一 lock 文件 → 自死锁，契约 §10 A8）；
 * 需要多步变更时在同一个 mutator 里改完再返回。
 */
export declare function mutateUsersFile<T>(filePath: string, mutator: (snapshot: UsersSnapshot) => T | Promise<T>, options?: {
    timeoutMs?: number;
    staleMs?: number;
    attempts?: number;
}): Promise<T>;
