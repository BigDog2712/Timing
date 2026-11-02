/**
 * TickBar — 「今日计时」分组与时间排序
 * -----------------------------------------------------------------------------
 * 需求（用户 2026-10-17）：今日计时里同一条事项的记录要合并成一行、按开始时间排序，
 * 并且显示开始时间与结束时间（参照 Timing v1.7.3 的今日计时面板：名字 / 起点 / 止点 / 时长四列）。
 *
 * 分组口径（ADR-021 起）：
 *   - 分组键 = **事项 id**。名字只是展示：`nameOf` 取的是事项的**当前**名字，所以改名前的
 *     历史记录仍会和主记录并成一行（它们本来就是同一条事项）；
 *   - 同名但**属于不同事项**时**不合并**，各自一行 —— ADR-021 允许新建同名事项，
 *     再按名字合会让两条独立事项挤成一行、右键只作用于其中一条；
 *   - 开始 = 组内最早 startedAt；结束 = 组内最晚 endedAt（有一条没结束时间就用其余有值的）；
 *   - 时长 = 组内 accumulatedSec 之和；条数 = 组内记录数（>1 时行尾标 ×N）。
 *
 * **[V0.4.2] 再加一层「连续性」切分**（用户口径：同一事项若时间不连续则分行记录，
 * 若时间连续则合并记录）：同一个事项一天里可能上午干一段、下午干一段，之前一律并成
 * 一行，起点与止点被拉成 `09:00–18:00`、时长却只有 2 小时——读起来像「一天都在干这件事」。
 * 现在按开始时间升序扫描，相邻两条的间隔 ≤ `CONTIGUOUS_GAP_MS` 才留在同一行，
 * 否则另起一行。合并后的行仍是「求和时长 + 最晚结束」，不做任何推算。
 *
 * 排序口径：按开始时间**升序**（同日时间线从上往下读，与参照版一致）。
 *
 * 纯函数、无副作用，便于单元测试。
 */
import type { TimeRecord } from '../types/domain';

/** 相邻两条记录间隔 ≤ 这个值就算「时间连续」。60s 覆盖「停止 → 又点开始」的手速与误触 */
export const CONTIGUOUS_GAP_MS = 60_000;

export interface TodayGroup {
  /** 事项 id（组内唯一；右键菜单的改名 / 删除 / 便利贴都作用于它） */
  itemId: number;
  /** 显示名（事项当前名字） */
  name: string;
  /** 组内最早开始时间 */
  startedAt: number;
  /** 组内最晚结束时间；组内所有记录都没有结束时间时为 null */
  endedAt: number | null;
  /** 合并后的累计秒数 */
  seconds: number;
  /** 组内记录条数 */
  count: number;
  /** [V0.3.12] 组内**最早开始**那条记录的 id（编辑起止时刻时改的就是它） */
  firstId: number;
  /** [V0.3.12] 组内**最晚结束**那条记录的 id */
  lastId: number;
  /**
   * [V0.4.2] 行 key。同一事项可能拆成多行，`grp-{itemId}-{firstId}` 才是唯一的
   * （旧实现用 `grp-{name}`，拆分后必然撞 key）。
   */
  key: string;
}

/**
 * 把今日已保存记录按「事项 + 时间连续性」合并、按开始时间升序。
 * @param rows `list_records` 返回的今日记录（顺序无关）
 * @param nameOf itemId → 显示名；查不到时调用方给兜底文案
 */
export function groupTodayRecords(
  rows: readonly TimeRecord[],
  nameOf: (itemId: number) => string,
): TodayGroup[] {
  /* 先按事项分桶、桶内按开始时间升序：连续性只在同一事项内部成立 */
  const buckets = new Map<number, TimeRecord[]>();
  for (const row of rows) {
    const list = buckets.get(row.itemId);
    if (list) list.push(row);
    else buckets.set(row.itemId, [row]);
  }

  const groups: TodayGroup[] = [];
  for (const [itemId, list] of buckets) {
    const ordered = [...list].sort((a, b) => a.startedAt - b.startedAt || a.id - b.id);
    let run: TodayGroup | null = null;
    for (const row of ordered) {
      /* 上一条没有结束时间（还没落库的脏数据）就无从判断连续，直接另起一行 */
      const joinable =
        run != null &&
        run.endedAt != null &&
        row.startedAt <= run.endedAt + CONTIGUOUS_GAP_MS;

      if (run && joinable) {
        run.seconds += row.accumulatedSec;
        run.count += 1;
        if (row.endedAt != null && row.endedAt > (run.endedAt ?? 0)) {
          run.endedAt = row.endedAt;
          run.lastId = row.id;
        }
        continue;
      }

      run = {
        itemId,
        name: nameOf(itemId),
        startedAt: row.startedAt,
        endedAt: row.endedAt ?? null,
        seconds: row.accumulatedSec,
        count: 1,
        firstId: row.id,
        lastId: row.id,
        key: `grp-${itemId}-${row.id}`,
      };
      groups.push(run);
    }
  }

  return groups.sort((a, b) => a.startedAt - b.startedAt || a.itemId - b.itemId);
}
