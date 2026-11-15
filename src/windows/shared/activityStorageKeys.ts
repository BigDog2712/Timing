/**
 * Timing — 分析窗存储键注册表 + 读写出口（T04-4，去 Patina 化）
 * -----------------------------------------------------------------------------
 * **全仓 `patina:` / `patina.icon-theme-colors` 存储键字面量只准住在本文件**
 * （判据 1 零白名单）：store 一律引用 `ACTIVITY_SLOT_RECORD` / 读写出口，
 * 不许自己再写一遍老键——否则"注册表 ↔ 代码字面量双向一致"（判据 2）就没有意义。
 *
 * 账目（写死常量，测试锁）：24 = **20 个可迁移**（带 `target`）+ **4 个只读老键**
 * （无 `target`：v2 异 schema / 更早键名 ×2 / 路径 B）。第 25 个成员是动态模板
 * `ACTIVITY_KEY_TEMPLATES`——它不是键，是**前缀**，兜注册表建成之后才出现的
 * 第 5 个导出格式（M-3）。
 *
 * ## 保证方式：出口惰性一次性（§4.5）
 *
 *   · 三个读写出口（read / write / remove）**进来第一件事都是 `ensureMigrated()`**。
 *     靠调用关系、不靠 import 排行：格式化器 / eslint --fix 挪动 import 行不失效；
 *     `boardStore.ts:96` 这种**模块求值期读盘**也被覆盖（它的 `loadLayout()` 走出口）。
 *   · **写出口也过闸**：否则"默认值先落盘 ⇒ 迁移 skip ⇒ 老值永久判死"（M-14）。
 *   · `state` 只有 `'idle' | 'done'` 两态，**没有"运行中"态**——那会让迁移期间的
 *     读者拿到半成品且无任何症状（施工单 §10.11）。
 *   · `state = 'done'` 在 **finally**，不在正常路径：一次意外抛出（不是逐槽 catch
 *     能盖住的，比如 `localStorage` 这个 getter 本身抛）若不置 done，之后的每一次读
 *     都会重跑一遍必然抛的迁移，并被逐槽 catch 掩盖成"迁移一直没生效"。
 *   · 迁移完成后**不回落老键**（§4.6 / M-15）：`removeActivityKey` 之后老键还在盘上
 *     （永不删），若读路径回落老键，用户"越清除越回不去"。所以带 `target` 的槽
 *     读出口**只读新键**。
 *
 * 为什么不用注册钩子（`registerActivityMigration`）：未注册时静默 no-op ⇒
 * 迁移永不发生、零报错——本批最不想要的失效形态。
 */
import { migrateActivityStorage } from './migrateActivityStorage';
import type { ActivitySlot } from './migrateActivityStorage';

/** 24 槽的逻辑名。新增槽 = 这里 +1、SLOT_RECORD +1（Record 保证穷尽）、消费方 +1。 */
export type ActivitySlotName =
  | 'classificationObjectMode'
  | 'boardLayout'
  | 'boardLayoutV2'
  | 'boardLayoutDefault'
  | 'boardLayoutLibrary'
  | 'boardLocked'
  | 'boardZoom'
  | 'destinationDetailMinSecs'
  | 'destinationDetailMinSecsLegacy'
  | 'destinationDetailZoomHours'
  | 'destinationDetailZoomHoursLegacy'
  | 'exportFormat'
  | 'exportRangeMode'
  | 'exportFieldsCsv'
  | 'exportFieldsSqlite'
  | 'exportFieldsParquet'
  | 'exportFieldsMarkdown'
  | 'historyDayDistributionMode'
  | 'historyTimelineZoomHours'
  | 'historyTimelineMode'
  | 'lastActiveView'
  | 'pendingUpdateRelaunchView'
  | 'mainWindowSize'
  | 'iconThemeColors';

/** 收敛逐槽对象字面量；`target` 缺省 = 只读老键（迁移跳过且不建新键，契约 8）。 */
function slot(name: ActivitySlotName, legacy: string, target?: string, lifetime: 'preference' | 'transient' = 'preference'): ActivitySlot {
  return { name, legacy, ...(target !== undefined ? { target } : {}), lifetime };
}

/**
 * 注册表本体。`Record<ActivitySlotName, …>` 让 TS 保证 24 个名字一个不少；
 * 老键字面量**只出现在这里**（判据 1 的声明行）。
 * 点号键 1 个：`iconThemeColors`（Map 的序列化，迁移整串复制、不解析，§3.4）。
 * `boardLayoutV2`：v2 的 `x` 是列号，异 schema，冻结（契约 6），v2 与 :v3 并存是正常的。
 * `historyTimelineMode`：路径 B——搬进后端设置 `history_timeline_mode`，成功后删
 * （§5.2 例外），删除在 `activityDisplaySettingsStore`，不在迁移模块（契约 2）。
 * `destinationDetail*Legacy` ×2：更早的键名，只读回落。
 */
export const ACTIVITY_SLOT_RECORD: Readonly<Record<ActivitySlotName, ActivitySlot>> = {
  classificationObjectMode: slot('classificationObjectMode', 'patina:classification-object-mode', 'activity:classification-object-mode'),
  boardLayout: slot('boardLayout', 'patina:dashboard-layout:v3', 'activity:dashboard-layout:v3'),
  boardLayoutV2: slot('boardLayoutV2', 'patina:dashboard-layout:v2'),
  boardLayoutDefault: slot('boardLayoutDefault', 'patina:dashboard-layout:default:v1', 'activity:dashboard-layout:default:v1'),
  boardLayoutLibrary: slot('boardLayoutLibrary', 'patina:dashboard-layout:library:v1', 'activity:dashboard-layout:library:v1'),
  boardLocked: slot('boardLocked', 'patina:dashboard-layout:locked:v1', 'activity:dashboard-layout:locked:v1'),
  boardZoom: slot('boardZoom', 'patina:dashboard-zoom:v1', 'activity:dashboard-zoom:v1'),
  destinationDetailMinSecs: slot('destinationDetailMinSecs', 'patina:destination-detail-min-secs:v1', 'activity:destination-detail-min-secs:v1'),
  destinationDetailMinSecsLegacy: slot('destinationDetailMinSecsLegacy', 'patina:data-detail-min-secs'),
  destinationDetailZoomHours: slot('destinationDetailZoomHours', 'patina:destination-detail-timeline-zoom-hours:v1', 'activity:destination-detail-timeline-zoom-hours:v1'),
  destinationDetailZoomHoursLegacy: slot('destinationDetailZoomHoursLegacy', 'patina:data-destination-detail-timeline-zoom-hours:v1'),
  exportFormat: slot('exportFormat', 'patina:export-format', 'activity:export-format'),
  exportRangeMode: slot('exportRangeMode', 'patina:export-range-mode', 'activity:export-range-mode'),
  exportFieldsCsv: slot('exportFieldsCsv', 'patina:export-fields:csv', 'activity:export-fields:csv'),
  exportFieldsSqlite: slot('exportFieldsSqlite', 'patina:export-fields:sqlite', 'activity:export-fields:sqlite'),
  exportFieldsParquet: slot('exportFieldsParquet', 'patina:export-fields:parquet', 'activity:export-fields:parquet'),
  exportFieldsMarkdown: slot('exportFieldsMarkdown', 'patina:export-fields:markdown', 'activity:export-fields:markdown'),
  historyDayDistributionMode: slot('historyDayDistributionMode', 'patina:history-day-distribution-mode', 'activity:history-day-distribution-mode'),
  historyTimelineZoomHours: slot('historyTimelineZoomHours', 'patina:history-timeline-zoom-hours', 'activity:history-timeline-zoom-hours'),
  historyTimelineMode: slot('historyTimelineMode', 'patina:history-timeline-mode'),
  lastActiveView: slot('lastActiveView', 'patina:last-active-view', 'activity:last-active-view'),
  /* 唯一 transient：升级重启后消费一次即弃（§5.1 第 3 档的删除放写入成功分支，不进迁移）。 */
  pendingUpdateRelaunchView: slot('pendingUpdateRelaunchView', 'patina:pending-update-relaunch-view', 'activity:pending-update-relaunch-view', 'transient'),
  mainWindowSize: slot('mainWindowSize', 'patina:window-size:v1', 'activity:window-size:v1'),
  iconThemeColors: slot('iconThemeColors', 'patina.icon-theme-colors.v2', 'activity.icon-theme-colors.v2'),
};

/** 24 槽平铺（迁移入口吃这个）。 */
export const ACTIVITY_SLOTS: readonly ActivitySlot[] = Object.values(ACTIVITY_SLOT_RECORD);

/**
 * 动态模板（§3.2）：**不是键，是前缀**。不在 24 槽账目里（`ACTIVITY_SLOTS.length === 24`
 * 是判据），迁移时与槽一起传给 `migrateActivityStorage`，靠 `dynamic: true` 走枚举回退。
 * 前缀字面量按判据 1 只许出现在注册表声明行。
 */
export const ACTIVITY_KEY_TEMPLATES: readonly ActivitySlot[] = [
  { name: 'exportFieldsTemplate', legacy: 'patina:export-fields:', target: 'activity:export-fields:', lifetime: 'preference', dynamic: true },
];

let migrationState: 'idle' | 'done' = 'idle';

/**
 * 惰性一次性迁移闸。两态与 `finally` 的原因见文件头；整体失败 = 静默成功：
 * done + 等效 0/0/0，不抛、不重试（§4 契约 4）。导出只给
 * `activityStorageBootstrap.ts`（entry 首行 import 的模块级副作用）用，
 * 其余任何调用方都请走读写出口，不要手工调它。
 */
export function ensureMigrated(): void {
  if (migrationState === 'done') return;
  try {
    migrateActivityStorage([...ACTIVITY_SLOTS, ...ACTIVITY_KEY_TEMPLATES], localStorage);
  } catch {
    /* localStorage 这个 getter 自己抛（受限上下文）⇒ 本轮迁移整体失败。
       不标记失败、不重试：done 之后所有出口照常工作，键一律按"没有"处理。 */
  } finally {
    migrationState = 'done';
  }
}

/** 槽的**当前键**：带 `target` 的新键，否则老键（只读槽的键就是老键）。 */
export function activityKeyOf(name: ActivitySlotName): string {
  return ACTIVITY_SLOT_RECORD[name].target ?? ACTIVITY_SLOT_RECORD[name].legacy;
}

/** 槽的老键（只读槽回退 / 路径 B 的删除目标用它取，store 不许写字面量）。 */
export function activityLegacyKeyOf(name: ActivitySlotName): string {
  return ACTIVITY_SLOT_RECORD[name].legacy;
}

/**
 * 读出口。**第一件事是迁移闸**；带 `target` 的槽在迁移完成后**只读新键、不回落老键**
 * （§4.6 / M-15：老键永不删，回落会让"清除"永远失效）。存储不可用 ⇒ null（不抛）。
 */
export function readActivityKey(name: ActivitySlotName): string | null {
  ensureMigrated();
  try {
    return localStorage.getItem(activityKeyOf(name));
  } catch {
    return null;
  }
}

/**
 * 写出口。**写也过闸**（M-14）：先迁移再写，保证"迁移 skip ⇒ 老值判死"不可能发生——
 * 被写的槽迁移先复制、随后被本写入覆盖，用户的写入永远赢。失败 ⇒ false（不抛）。
 */
export function writeActivityKey(name: ActivitySlotName, value: string): boolean {
  ensureMigrated();
  try {
    localStorage.setItem(activityKeyOf(name), value);
    return true;
  } catch {
    return false;
  }
}

/** 删出口（用户主动"清除/重置"路径）。只删当前键，**不碰老键**（永不删，§5.1）。 */
export function removeActivityKey(name: ActivitySlotName): boolean {
  ensureMigrated();
  try {
    localStorage.removeItem(activityKeyOf(name));
    return true;
  } catch {
    return false;
  }
}

/**
 * 跨窗 storage 事件过滤：键属于注册表（含动态前缀）才算。`key === null` 是 `clear()`，
 * 整表被清当然相关。
 */
export function isActivityKeyEvent(event: { key: string | null }): boolean {
  if (event.key === null) return true;
  for (const entry of [...ACTIVITY_SLOTS, ...ACTIVITY_KEY_TEMPLATES]) {
    if (event.key === entry.legacy || event.key === entry.target) return true;
    if (entry.dynamic === true && (event.key.startsWith(entry.legacy) || event.key.startsWith(entry.target ?? ''))) {
      return true;
    }
  }
  return false;
}
