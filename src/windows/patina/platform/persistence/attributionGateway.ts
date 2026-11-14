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
 * ## 为什么切片结果里没有「未归属」这一项
 *
 * 切片只保留与块相交的事实；块内没被采集到的时间**不出现**，而不是补一条 `other`。
 * 补零会让「隐私排除 / 追踪没启动」看起来像「在别的应用上待了一小时」。
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
