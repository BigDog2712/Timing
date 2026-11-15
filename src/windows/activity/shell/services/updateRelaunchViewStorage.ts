import type { View } from "../types/view";
import {
  readActivityKey,
  removeActivityKey,
  writeActivityKey,
} from "../../../shared/activityStorageKeys";

/* [T04-4] 键名从注册表取（老键字面量只住 activityStorageKeys.ts）；读写走出口（先过迁移闸）。
   `pendingUpdateRelaunchView` 是唯一 transient 槽：消费即删（只删当前键，老键永不碰）。 */

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

export function markPendingUpdateRelaunchViewRestore() {
  writeActivityKey("pendingUpdateRelaunchView", "1");
}

export function clearPendingUpdateRelaunchViewRestore() {
  removeActivityKey("pendingUpdateRelaunchView");
}

export function consumePendingUpdateRelaunchView(): View | null {
  const pendingValue = readActivityKey("pendingUpdateRelaunchView");

  if (pendingValue !== "1") {
    return null;
  }

  removeActivityKey("pendingUpdateRelaunchView");
  return readLastActiveView();
}
