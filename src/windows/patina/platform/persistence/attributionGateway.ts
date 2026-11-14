/**
 * 事项归属网关：应用分类绑定 / 块投影 / 子记录切片。
 *
 * 三条命令组构成「点开时间轴上的块，看到它的子记录」这条路（Rust 侧：
 * `commands/insight/attribution_cmd.rs` + `focus_block_cmd.rs`）。
 *
 * ## 为什么要先 `projectFocusBlocks`
 *
 * `focus_blocks` 是**投影**（真源是业务库的 `time_records`）。读之前不推，块表就是空的
 * 或过期的。推与读拆成两个动作是因为代价不对称：推要跨库读全表，读只查区间。
 * 计时结束、启动、以及用户手动点「刷新」时各推一次即可。
 *
 * ## 「未采集」与「未归属」是两件事
 *
 * 切片只保留与块相交的事实 —— 块内没被采集到的时间**不补 `other` 分类**
 * （补零会让「隐私排除 / 追踪没启动」看起来像「在别的应用上待了一小时」）。
 * 但它必须作为 `gaps` **单独返回**：块到 11:30、chrome 只到 11:00，中间那半小时
 * 不显示出来，上下两层就对不上，而用户只会以为「时间轴画错了」。
 *
 * ## 旧 KV 的迁移
 *
 * `backfillLegacyBindings` 把 `__app_override::` / `__app_item_binding::` 灌进新表，
 * 守卫键保证只真跑一次。之后旧页保存仍会写 KV（它的 displayName / color / track 等
 * 字段还在用，新表没有这些列），但**分类归属**由 `appCategoryCandidateSync` 在同一刻
 * 同步成新表的单条候选 —— 切片只读新表，所以「旧页改了分类、切片没变」这个零报错
 * 失效被堵在保存那一刻。
 */
import { invokeWithCommandError } from "./commandError.ts";

/** 一行「应用 → 分类」绑定。`priority` 越小越靠前，最小者即「分类首位」。 */
export interface AppCategoryRow {
  appKey: string;
  categoryKey: string;
  priority: number;
}

/** 一个事项块（`focus_blocks` 的一行）。`endTime` 为 null = 进行中。 */
export interface FocusBlockRow {
  uid: string;
  /** 发起设备，不是「本机」 */
  deviceId: string;
  itemUid: string;
  itemName: string;
  /** 事项分类的快照（事项改名 / 改分类后历史块不漂移） */
  categoryKey: string | null;
  startTime: number;
  endTime: number | null;
}

/** 一条子记录：某应用在某段区间内的活动，带解析后的分类。 */
export interface ChildSegmentRow {
  appKey: string;
  appName: string;
  startMs: number;
  endMs: number;
  categoryKey: string;
}

/** 块详情：块本身 + 切出来的子记录 + 按分类汇总（毫秒）。 */
export interface BlockDetail {
  block: FocusBlockRow;
  segments: ChildSegmentRow[];
  /** 分类 → 毫秒。键顺序由后端 BTreeMap 给出，三次刷新不会换位置 */
  totalsByCategory: Record<string, number>;
}

/** 投影结果：让界面能说清「这次同步了多少块」。 */
export interface ProjectionReport {
  upserted: number;
  skipped: number;
}

/** 列出应用分类绑定。不给 `appKey` 就是全部应用（设置页总览）。 */
export function listAppCategories(appKey?: string): Promise<AppCategoryRow[]> {
  return invokeWithCommandError<AppCategoryRow[]>("cmd_list_app_categories", {
    appKey: appKey ?? null,
  });
}

/** 设一条绑定（幂等）。把它设为更小的 `priority` 就是「提到分类首位」。 */
export function setAppCategory(
  appKey: string,
  categoryKey: string,
  priority: number,
): Promise<void> {
  return invokeWithCommandError<void>("cmd_set_app_category", { appKey, categoryKey, priority });
}

/** 删一条绑定。返回是否真的删掉了一行。 */
export function removeAppCategory(appKey: string, categoryKey: string): Promise<boolean> {
  return invokeWithCommandError<boolean>("cmd_remove_app_category", { appKey, categoryKey });
}

/** 把业务库的计时记录投影进块表。`sinceMs` 省略 = 全量重推（修复用）。 */
export function projectFocusBlocks(sinceMs?: number): Promise<ProjectionReport> {
  return invokeWithCommandError<ProjectionReport>("cmd_project_focus_blocks", {
    sinceMs: sinceMs ?? null,
  });
}

/** 按区间读块（与区间相交即返回，含进行中的块）。 */
export function listFocusBlocks(startMs: number, endMs: number): Promise<FocusBlockRow[]> {
  return invokeWithCommandError<FocusBlockRow[]>("cmd_list_focus_blocks", { startMs, endMs });
}

/** 读一个块的子记录。块不存在时抛错（消息里带「先跑投影」）。 */
export function getBlockDetail(blockUid: string): Promise<BlockDetail> {
  return invokeWithCommandError<BlockDetail>("cmd_get_block_detail", { blockUid });
}

/** 一段「未采集」的区间（块内在跑，但没有应用事实落进来）。 */
export interface TimelineGap {
  startMs: number;
  endMs: number;
}

/** 时间轴上层的一行（= 一个事项）。 */
export interface ItemTimelineRow {
  itemUid: string;
  itemName: string;
  categoryKey: string | null;
  startMs: number;
  /** null = 还有块在跑 */
  endMs: number | null;
  running: boolean;
  /** 并集时长（**不是**各块之和：双端并行不能算两遍） */
  totalMs: number;
  /** 块数量，>1 说明中途停过 */
  blockCount: number;
  segments: ChildSegmentRow[];
  gaps: TimelineGap[];
  totalsByCategory: Record<string, number>;
}

/** 旧 KV → 新表的回填结果（计数给设置页显示「迁移了 N 条」）。 */
export interface BackfillReport {
  alreadyDone: boolean;
  appCategories: number;
  itemBindings: number;
  skipped: number;
}

/**
 * 双层时间轴：事项 → 子记录 + 空档。
 *
 * 读之前后端会补一次增量投影（自愈），所以不需要调用方先 `projectFocusBlocks`。
 */
export function getItemTimeline(startMs: number, endMs: number): Promise<ItemTimelineRow[]> {
  return invokeWithCommandError<ItemTimelineRow[]>("cmd_get_item_timeline", { startMs, endMs });
}

/** 把旧 KV 配置灌进新表（守卫键保证只真跑一次，重复调用是空操作）。 */
export function backfillLegacyBindings(): Promise<BackfillReport> {
  return invokeWithCommandError<BackfillReport>("cmd_backfill_legacy_bindings", {});
}
