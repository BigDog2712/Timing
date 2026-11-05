/**
 * Timing — 「今日计时」分组与时间排序
 * -----------------------------------------------------------------------------
 * 需求（用户 2026-10-17）：今日计时里同一条事项的记录要合并成一行、按开始时间排序，
 * 并且显示开始时间与结束时间（参照 Timing v1.7.3 的今日计时面板：名字 / 起点 / 止点 / 时长四列）。
 *
 * 分组口径（V0.11.1 起，取代 ADR-021 的「按 id 分」）：
 *   - **分组键 = 名字**。用户口径（2026-11-05）：「名称只按今日事项看」——
 *     今天里叫同一个名字的就是同一件事，今天新建的同名事项不再各占一行；
 *   - 名字查不到（事项已删，调用方给兜底文案）时退回**按 id** 认，
 *     否则一堆已删记录会挤成一行、右键只能改到其中一条；
 *   - 开始 = 组内最早 startedAt；结束 = 组内最晚 endedAt（有一条没结束时间就用其余有值的）；
 *   - 时长 = 组内 accumulatedSec 之和；条数 = 组内记录数（>1 时行尾标 ×N）；
 *   - 组上的 `itemId` 取组内**最早那条**记录的 itemId，供右键改名 / 便利贴等操作使用。
 *
 * **[V0.4.2] 再加一层「连续性」切分**（用户口径：同一事项若时间不连续则分行记录，
 * 若时间连续则合并记录）：同一个事项一天里可能上午干一段、下午干一段，之前一律并成
 * 一行，起点与止点被拉成 `09:00–18:00`、时长却只有 2 小时——读起来像「一天都在干这件事」。
 * 现在按开始时间升序扫描，相邻两条的间隔 ≤ `CONTIGUOUS_GAP_MS` 才留在同一行，
 * 否则另起一行。合并后的行仍是「求和时长 + 最晚结束」，不做任何推算。
 *
 * 注意切分只发生在**展示层**：数据库里仍是各自独立的 `records` 行、事项仍是一条，
 * md 也仍是同一个文件 —— 用户口径「在数据库和 md 文档中合并」。
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
 * 「名字不成立」的兜底文案集合：出现这些名字说明事项已删或查不到，
 * 身份必须退回 id，否则所有已删记录会挤成一行。
 * 新增兜底文案时**必须同步这里**（`itemStore.itemName` / 各面板的兜底串）。
 */
export const UNNAMED_FALLBACKS: ReadonlySet<string> = new Set(['未归类', '已删除事项', '']);

/**
 * 分组身份：今天同名的算一件事；名字拿不到时按 id 认。
 * 用前缀区分两种键，避免某个事项真叫「id:3」时与兜底键撞车。
 */
function identityOf(name: string, itemId: number): string {
  return UNNAMED_FALLBACKS.has(name) ? `id:${itemId}` : `name:${name}`;
}

/**
 * 把今日已保存记录按「名字 + 时间连续性」合并、按开始时间升序。
 * @param rows `list_records` 返回的今日记录（顺序无关）
 * @param nameOf itemId → 显示名；查不到时调用方给兜底文案
 */
export function groupTodayRecords(
  rows: readonly TimeRecord[],
  nameOf: (itemId: number) => string,
): TodayGroup[] {
  /* 按名字分桶（今日同名即同一件事）、桶内按开始时间升序：连续性只在同一件事内部成立 */
  const buckets = new Map<string, TimeRecord[]>();
  for (const row of rows) {
    const key = identityOf(nameOf(row.itemId), row.itemId);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const groups: TodayGroup[] = [];
  for (const list of buckets.values()) {
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
        itemId: row.itemId,
        name: nameOf(row.itemId),
        startedAt: row.startedAt,
        endedAt: row.endedAt ?? null,
        seconds: row.accumulatedSec,
        count: 1,
        firstId: row.id,
        lastId: row.id,
        key: `grp-${row.itemId}-${row.id}`,
      };
      groups.push(run);
    }
  }

  return groups.sort((a, b) => a.startedAt - b.startedAt || a.itemId - b.itemId);
}
