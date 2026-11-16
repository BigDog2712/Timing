import type { View } from "../types/view";
import {
  readActivityKey,
  writeActivityKey,
} from "../../../shared/activityStorageKeys";

/* [T04-4] 键名从注册表取（老键字面量只住 activityStorageKeys.ts）；读写走出口（先过迁移闸）。
   [O3 2026-11-16] 这里原来还住着一个 `pendingUpdateRelaunchView` transient 槽（升级重启后
   「恢复到升级前那个视图」）。更新通道整批删除后它再没有任何写入方，槽与
   `mark/clear/consume` 三个函数一并删掉 —— 留一段永远读到 null 的"恢复"逻辑，
   比没有更容易让人误判「视图记忆坏了」。 */

function isView(value: string | null): value is View {
  /* [T04] "tools" 已从 View 联合移除：旧会话存的 "tools" 在这里自然判非法，
     回落到 dashboard —— 不需要专门的迁移键。 */
  return value === "dashboard"
    || value === "history"
    || value === "data"
    || value === "mapping"
    || value === "settings"
    || value === "about";
}

export function rememberLastActiveView(view: View) {
  writeActivityKey("lastActiveView", view);
}

export function readLastActiveView(): View | null {
  const storedView = readActivityKey("lastActiveView");
  return isView(storedView) ? storedView : null;
}
