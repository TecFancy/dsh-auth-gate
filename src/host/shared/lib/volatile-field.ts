/**
 * 配置里的 volatile 字段：值是盒子不是值，经 `get()` 读当前快照。
 *
 * 宿主 `dsh-settings` 只把 `.volatile()` 的字段投影成设置页表单，也只允许写回这些字段
 * （`volatileForm()` / `isVolatilePath()`）。所以「管理员能在设置页改」和「schema 上标了
 * `.volatile()`」是同一件事，漏标的表现是写回被拒、界面却仍显示成功。
 *
 * 放在 `shared/lib` 而不是某个功能段里：遥测的 `installId` 与通行密钥的
 * `passkeyConditionalUi` 都要用它，谁都不该为了一个类型去 import 另一条功能的段。
 */
export interface VolatileField<T> {
  get(): T;
}
