/**
 * [0.13.2] 统计页的区间算术（纯函数，不认识 React）。
 *
 * 页面这一轮从「只看某一天」扩到「某一天 / 近 7 天」，于是需要合并多天：
 * 合并、排序、取前 N、日均、与昨天比差。这些都是**会静默算错**的地方
 * （少加一天、把读不到的天当 0 摊进日均、并列时排序不稳），所以单独一份并带判据。
 *
 * ## 一条硬纪律：合计只从行求和，不再读 `totalSec`
 * `UsageDayDto.totalSec` 是后端算的，行是后端给的明细，两者本该相等。但界面里
 * 「合计」和「条长」必须**同一份数**（0.12.2 计时分布卡就死在这里：环心读一个来源、
 * 卡头读另一个，同屏「今天还没有计时」+「40m 今日合计」）。这里统一由
 * `rangeOf()` 用行求和产出合计，页面只认它。
 */
import type { UsageDayDto } from '../types/domain/usage';

/** 合并后的一行（区间维度，不是单日）。 */
export interface UsageRow {
  packageName: string;
  /** 区间内累计前台秒数 */
  sec: number;
  /** 区间内最早一次进入前台的毫秒时刻（0 = 未知） */
  first: number;
  /** 区间内最晚一次离开前台的毫秒时刻（0 = 未知） */
  last: number;
  /** 在几天里出现过（1..dayCount） */
  days: number;
  /** 系统给的应用显示名（空 = 不知道，渲染走 `displayName` 回落） */
  label: string;
  /** `data:image/webp;base64,…` 图标（空 = 没有，渲染走首字瓦片） */
  icon: string;
}

/** 一个区间的读数。 */
export interface UsageRange {
  /** 参与合并的天数 —— 读到的那些，**不是**窗口长度 */
  dayCount: number;
  totalSec: number;
  /** 日均：只按读到的天数平均（读不到的天不许当 0 摊进来） */
  avgPerDaySec: number;
  rows: UsageRow[];
}

/** 按包名合并多天。排序：时长降序，同长按键名（保证渲染稳定，不依赖 Map 插入顺序）。 */
export function mergeRows(days: readonly UsageDayDto[]): UsageRow[] {
  const map = new Map<string, UsageRow>();
  for (const day of days) {
    for (const row of day.rows) {
      if (row.packageName === '' || row.sec <= 0) continue;
      const hit = map.get(row.packageName);
      if (hit == null) {
        map.set(row.packageName, {
          packageName: row.packageName,
          sec: row.sec,
          first: row.first,
          last: row.last,
          days: 1,
          label: row.label ?? '',
          icon: row.icon ?? '',
        });
        continue;
      }
      hit.sec += row.sec;
      hit.days += 1;
      /* 名字与图标**只补空位，不覆盖已有值**：同一个包的名字是稳定的，但某一天可能查不到
         （那天包还没装 / 那天取图标失败）。用「先遇到的非空值」，列表就不会因为
         某一天缺元数据而整行退回包名短名。 */
      if (hit.label === '') hit.label = row.label ?? '';
      if (hit.icon === '') hit.icon = row.icon ?? '';
      /* `first` / `last` 的 0 是「不知道」，不是「零点」：拿 0 去比 MIN 会把区间起点
         拉到 1970 年，界面上显示 00:00；所以只让已知值参与比较。 */
      if (row.first > 0 && (hit.first === 0 || row.first < hit.first)) hit.first = row.first;
      if (row.last > hit.last) hit.last = row.last;
    }
  }
  return [...map.values()].sort(
    (a, b) => b.sec - a.sec || a.packageName.localeCompare(b.packageName),
  );
}

/** 区间读数：合并 → 求和 → 日均。`days` 传**已读到**的那些天。 */
export function rangeOf(days: readonly UsageDayDto[]): UsageRange {
  const rows = mergeRows(days);
  const totalSec = rows.reduce((sum, row) => sum + row.sec, 0);
  const dayCount = days.length;
  return {
    dayCount,
    totalSec,
    avgPerDaySec: dayCount > 0 ? Math.round(totalSec / dayCount) : 0,
    rows,
  };
}

/**
 * 取前 `limit` 行，其余合成一行「其他 N 个应用」。
 *
 * 为什么不是直接截断：截断会让「列表之和 < 合计」，用户对不上账。合成一行之后
 * 列表之和恒等于合计（有判据）。
 */
export function topRows(
  rows: readonly UsageRow[],
  limit: number,
): { top: UsageRow[]; rest: UsageRow | null } {
  if (!Number.isFinite(limit) || limit <= 0 || rows.length <= limit) {
    return { top: [...rows], rest: null };
  }
  const top = rows.slice(0, limit);
  const tail = rows.slice(limit);
  const rest: UsageRow = {
    packageName: `其他 ${tail.length} 个应用`,
    sec: tail.reduce((sum, row) => sum + row.sec, 0),
    first: tail.reduce((min, row) => (row.first > 0 && (min === 0 || row.first < min) ? row.first : min), 0),
    last: tail.reduce((max, row) => Math.max(max, row.last), 0),
    days: tail.reduce((max, row) => Math.max(max, row.days), 0),
    /* 聚合行不是应用：没有名字也没有图标。渲染时直接用它的 `packageName`（那是给用户看的字面量）。 */
    label: '',
    icon: '',
  };
  return { top, rest };
}

/** 与前一天比差（秒）。任一侧没读到 → `null`，界面不显示对比，**不显示 0**。 */
export function deltaSec(current: UsageDayDto | undefined, previous: UsageDayDto | undefined): number | null {
  if (current == null || previous == null) return null;
  return current.totalSec - previous.totalSec;
}

/**
 * 某个应用在窗口内逐日的秒数（从旧到新）。**没读到的那天是 `null`，不是 0**：
 * 详情柱必须与主趋势柱同一口径，否则「昨天没用手機」和「昨天没读到」长得一样。
 */
export function appSeries(
  days: Readonly<Record<string, UsageDayDto | undefined>>,
  keys: readonly string[],
  packageName: string,
): (number | null)[] {
  return keys.map((key) => {
    const day = days[key];
    if (day == null) return null;
    const row = day.rows.find((item) => item.packageName === packageName);
    return row?.sec ?? 0;
  });
}

/** 占比（整数百分比）。合计为 0 时回 0，不产生 `NaN%`。 */
export function percentOf(sec: number, totalSec: number): number {
  if (!Number.isFinite(sec) || !Number.isFinite(totalSec) || totalSec <= 0) return 0;
  return Math.max(0, Math.round((sec / totalSec) * 100));
}
