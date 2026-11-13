import type { View } from "../types/view";
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "../../platform/browser/browserStorageGateway.ts";

const LAST_ACTIVE_VIEW_KEY = "patina:last-active-view";
const PENDING_UPDATE_RELAUNCH_VIEW_KEY = "patina:pending-update-relaunch-view";

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
  writeBrowserStorage(LAST_ACTIVE_VIEW_KEY, view);
}

export function readLastActiveView(): View | null {
  const storedView = readBrowserStorage(LAST_ACTIVE_VIEW_KEY);
  return isView(storedView) ? storedView : null;
}

export function markPendingUpdateRelaunchViewRestore() {
  writeBrowserStorage(PENDING_UPDATE_RELAUNCH_VIEW_KEY, "1");
}

export function clearPendingUpdateRelaunchViewRestore() {
  removeBrowserStorage(PENDING_UPDATE_RELAUNCH_VIEW_KEY);
}

export function consumePendingUpdateRelaunchView(): View | null {
  const pendingValue = readBrowserStorage(PENDING_UPDATE_RELAUNCH_VIEW_KEY);

  if (pendingValue !== "1") {
    return null;
  }

  removeBrowserStorage(PENDING_UPDATE_RELAUNCH_VIEW_KEY);
  return readLastActiveView();
}
