import { invoke } from "@tauri-apps/api/core";

/**
 * 反向数据桥：Patina 窗读**宿主**的计时记录（D2 反向）。
 *
 * 正向桥（宿主读 Patina 的活动库）走的是 `app/patina_bridge.rs` 的只读 sqlx 池；
 * 反方向不另开连接——宿主本来就有自己的连接池，直接调它已有的两条命令：
 *   `list_records`（区间内的计时记录）· `list_items`（事项名）
 * 只做两件事：把参数递过去、把返回体裁成窗口需要的字段。
 *
 * 为什么不在 Patina 侧新加一条聚合命令：那要动宿主的命令表与契约四面
 * （`ipc_commands.rs` / `IpcApi` / `ipc.ts` / mock），而 `ipc.ts` 正卡在 300 行门禁上；
 * 这里一天只有几十条记录，两条已有命令足够。
 *
 * 权限在 `src-tauri/permissions/patina-host-bridge.toml`：只放行这两条**只读**命令，
 * 宿主自己的写命令一条都不给 Patina 窗。
 */

/** 列表一次取这么多：一天的计时记录通常几十条，200 是「一天不做折叠也够」的量。 */
const RECORD_LIMIT = 200;

/* 只声明本功能用到的字段 —— 宿主 DTO 改名时，改这里一处即可，不必让 vendored 侧
   跟着宿主的类型走。 */
interface RawRecord {
  id: number;
  itemId: number;
  accumulatedSec: number;
  /* [P0-02] 泳道要的是**墙钟跨度**（不是累计秒）：起止时间才能与活动轨对齐。
     宿主 `TimeRecord` 本来就有这三个字段（`src/types/domain/models.ts:86-104`），
     只是 B1 的聚合卡只用了 `accumulatedSec`，所以此前没声明。 */
  startedAt: number;
  endedAt: number | null;
  runningSince: number | null;
}

interface RawRecordPage {
  items?: RawRecord[];
}

interface RawItem {
  id: number;
  name: string;
}

/** 一条记录被裁剪到「哪个事项、多少秒」。 */
export interface TimingRecordSlice {
  itemId: number;
  seconds: number;
}

/** [P0-02] 一条记录在墙钟上的起止（泳道段用）。 */
export interface TimingRecordSpan {
  id: number;
  itemId: number;
  seconds: number;
  startedAt: number;
  /** `null` = 进行中（FUSION-ARCH-v1 §6.2：`endedAt === null` ⇒ 进行中） */
  endedAt: number | null;
  /** 当前计时段起点；非 null 表示正在跑。泳道只用它判「进行中」，不做实时秒数。 */
  runningSince: number | null;
}

export interface TimingItemName {
  id: number;
  name: string;
}

/**
 * 取区间内的原始记录（唯一一次 `list_records`，两个消费方各取所需字段）。
 *
 * `from`/`to` 与宿主记录面板用同一对参数、同一个 SQL：两边的「今天」因此是**同一个口径**，
 * 不会出现「宿主说 2 小时、Patina 说 1 小时 40 分」。
 */
async function fetchRecords(fromMs: number, toMs: number): Promise<RawRecord[]> {
  const page = await invoke<RawRecordPage>("list_records", {
    from: fromMs,
    to: toMs,
    limit: RECORD_LIMIT,
  });
  return page.items ?? [];
}

/** 聚合卡用：只要「哪个事项、多少秒」（历史页左侧「同期计时」一行）。 */
export async function loadTimingRecordSlices(
  fromMs: number,
  toMs: number,
): Promise<TimingRecordSlice[]> {
  const rows = await fetchRecords(fromMs, toMs);
  return rows.map((row) => ({
    itemId: row.itemId,
    seconds: row.accumulatedSec,
  }));
}

/** [P0-02] 泳道用：带起止时间的记录。 */
export async function loadTimingRecordSpans(
  fromMs: number,
  toMs: number,
): Promise<TimingRecordSpan[]> {
  const rows = await fetchRecords(fromMs, toMs);
  return rows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    seconds: row.accumulatedSec,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    runningSince: row.runningSince,
  }));
}

/** 取全部事项名（含已归档：昨天计过的事，今天归档了也得显示名字）。 */
export async function loadTimingItemNames(): Promise<TimingItemName[]> {
  const rows = await invoke<RawItem[]>("list_items", { includeArchived: true });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}
