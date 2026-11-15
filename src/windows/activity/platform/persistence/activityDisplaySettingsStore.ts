import { invokeWithCommandError } from "./commandError.ts";
import { loadSettingValue } from "./settingsPersistence.ts";
import { getBrowserLocalStorage } from "../browser/browserStorageGateway.ts";
import { activityLegacyKeyOf } from "../../../shared/activityStorageKeys";
import { parseActivityTimelineMode, type ActivityTimelineMode } from "../../shared/settings/activityDisplaySettings.ts";

const KEY = "history_timeline_mode";
/* [T04-4] 老键字面量只住 activityStorageKeys.ts（判据 1）。本文件的 `removeItem`
   是 §5.2 例外（路径 B：后端迁移成功后删老键），保持不动。 */
const LEGACY_KEY = activityLegacyKeyOf("historyTimelineMode");

/**
 * [T04-4] 单槽闸（§5.3）：只闸 `timelineMode`（唯一带 `await` 窗口的槽），不做全局闸。
 * `cmd_migrate_history_timeline_mode` 的 await 期间事件循环自由，UI 可能已经
 * 读过一次后端设置（此时是默认值）——若这个窗口里 save 落盘，后端有了值 ⇒ 迁移的
 * `existing !== null` 判定成立 ⇒ 老值被永久判死。闸由 `migrateActivityTimelineMode`
 * **await 成功返回之后**置真（不在 finally：失败也置真 = 闸形同不存在）；置真前
 * save 一律丢弃 + 一条 debug（失效可见），不排队不重试（重试会在迁移之后把默认值
 * 写回去，等于绕开闸）。路径 A 的 23 个同步槽不需要闸——出口惰性（§4.5）已保证
 * 「任何读写发生之前迁移一定已跑完」。
 */
let timelineMigrationDone = false;

export async function loadActivityTimelineMode(): Promise<ActivityTimelineMode> {
  return parseActivityTimelineMode(await loadSettingValue(KEY));
}

export async function migrateActivityTimelineMode(): Promise<ActivityTimelineMode> {
  const storage = getBrowserLocalStorage();
  const existing = await loadSettingValue(KEY);
  if (existing !== null) {
    try { storage?.removeItem(LEGACY_KEY); } catch { /* The canonical value already owns this preference. */ }
    timelineMigrationDone = true;
    return parseActivityTimelineMode(existing);
  }
  let legacy: string | null = null;
  try { legacy = storage?.getItem(LEGACY_KEY) ?? null; } catch { /* The canonical store remains available. */ }
  const result = await invokeWithCommandError<unknown>("cmd_migrate_history_timeline_mode", {
    legacyMode: parseActivityTimelineMode(legacy),
  });
  if (typeof result !== "string" || !["app", "category", "web"].includes(result)) throw new Error("Invalid timeline preference");
  try { storage?.removeItem(LEGACY_KEY); } catch { /* A later migration is insert-only. */ }
  timelineMigrationDone = true;
  return parseActivityTimelineMode(result);
}

export async function saveActivityTimelineMode(mode: ActivityTimelineMode): Promise<void> {
  if (!timelineMigrationDone) {
    console.debug("[timelineMode] migration pending, save dropped");
    return;
  }
  await invokeWithCommandError("cmd_commit_app_settings", { mutations: [{ key: KEY, value: mode }] });
}
