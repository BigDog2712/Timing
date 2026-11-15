/**
 * [0.13.2] 统计页的「数智」文案（纯函数）。
 *
 * 市面上的屏幕时间产品（Digital Wellbeing / 屏幕使用时间 / RescueTime）真正有用的
 * 不是那根柱子，而是**一句话告诉你变了什么**：「比昨天多用 43 分钟，主要来自抖音」。
 * 这类句子全靠数据算，所以单独一份纯函数 + 判据。
 *
 * ## 三条不许（都源自「读不到 ≠ 零」）
 * - 任一侧没读到 → **不产对比句**，不许把「没读到」说成「少用 100%」。
 * - 日均 / 连续天数只按**读到的天**算，缺的天不许当 0 参与。
 * - 占比、差值都取整到分钟/整数百分比；不到 1 分钟的差异不值得说一句。
 */
import { formatDuration, formatSpanCN, monthDayShort, shortName } from './usageFormat';
import { percentOf } from '../../services/usageRange';
import { shiftDayKey } from '../../services/usageActions';
import type { UsageDayDto } from '../../types/domain/usage';

export type InsightTone = 'up' | 'down' | 'info';

export interface Insight {
  tone: InsightTone;
  text: string;
}

export interface InsightInput {
  /** 已读到的天（键 = 本地日；缺键 = 没读到） */
  days: Readonly<Record<string, UsageDayDto | undefined>>;
  /** 趋势窗口，从旧到新 —— 最后一个是「今天」 */
  keys: readonly string[];
  /**
   * 以哪一天为「今天」说话（默认窗口最后一天）。
   *
   * **看往日时必须传那一天**：不传的话「比昨天多用 40 分钟」说的仍是今天比昨天，
   * 而用户正盯着 11/12 的读数 —— 一句看着相关其实无关的话比不说更坏。
   * 那一天的前一天若不在已读到的窗口里，对比句自然不产（见 `days[prevKey] == null`）。
   */
  anchor?: string;
  /** 最多给几条（默认 2：超过两条就没人看了） */
  limit?: number;
}

/** 按包名求和（对比「谁多了/谁少了」用）。 */
function sumByPackage(day: UsageDayDto): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of day.rows) {
    if (row.packageName === '' || row.sec <= 0) continue;
    map.set(row.packageName, (map.get(row.packageName) ?? 0) + row.sec);
  }
  return map;
}

/**
 * 「主要来自 X（+31 分钟）」——差值最大的那个应用，且必须与总差值同向。
 * 找不到同向变化（比如总量涨了但每个 app 都降了，只可能发生在数据不全时）就返回空串，
 * **不编一个理由**。
 */
function topMover(today: UsageDayDto, yesterday: UsageDayDto): string {
  const now = sumByPackage(today);
  const before = sumByPackage(yesterday);
  let bestPkg = '';
  let bestDelta = 0;
  for (const [pkg, sec] of now) {
    const delta = sec - (before.get(pkg) ?? 0);
    if (Math.abs(delta) > Math.abs(bestDelta)) {
      bestPkg = pkg;
      bestDelta = delta;
    }
  }
  if (bestPkg === '' || Math.abs(bestDelta) < 60) return '';
  const sign = bestDelta > 0 ? '+' : '-';
  return `，主要来自 ${shortName(bestPkg)}（${sign}${formatSpanCN(Math.abs(bestDelta))}）`;
}

/** 从窗口末尾（今天）往前数「逐日严格上升」的天数；不足 2 天有数据就回 0。 */
function risingStreak(
  days: Readonly<Record<string, UsageDayDto | undefined>>,
  keys: readonly string[],
): number {
  let streak = 0;
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const current = days[keys[i]];
    if (current == null) break;
    if (streak === 0) {
      streak = 1;
      continue;
    }
    const next = days[keys[i + 1]];
    if (next == null || current.totalSec >= next.totalSec) break;
    streak += 1;
  }
  return streak >= 2 ? streak : 0;
}

/** 窗口里用得最久的那天（忽略没读到的天）。并列时取**较近**的一天。 */
function longestDay(
  days: Readonly<Record<string, UsageDayDto | undefined>>,
  keys: readonly string[],
): { key: string; sec: number } | null {
  let best: { key: string; sec: number } | null = null;
  for (const key of keys) {
    const day = days[key];
    if (day == null || day.totalSec <= 0) continue;
    if (best == null || day.totalSec >= best.sec) best = { key, sec: day.totalSec };
  }
  return best;
}

/** 生成洞察句（按优先级：昨日对比 → 单应用过半 → 连续上升 → 最久一天）。 */
export function buildInsights({ days, keys, anchor, limit = 2 }: InsightInput): Insight[] {
  const out: Insight[] = [];
  const lastKey = keys[keys.length - 1];
  const anchorKey = anchor ?? lastKey;
  const isLatest = anchorKey === lastKey;
  const prevKey = anchorKey ? shiftDayKey(anchorKey, -1) : '';
  const today = anchorKey ? days[anchorKey] : undefined;
  const yesterday = prevKey === '' ? undefined : days[prevKey];

  if (today && yesterday) {
    const delta = today.totalSec - yesterday.totalSec;
    if (Math.abs(delta) >= 60) {
      out.push({
        tone: delta > 0 ? 'up' : 'down',
        text: `比昨天${delta > 0 ? '多' : '少'}用 ${formatSpanCN(Math.abs(delta))}${topMover(today, yesterday)}`,
      });
    }
  }

  /* 单应用过半：只在这天确实用够半小时时才说 —— 「占了今天 60%」在总共 3 分钟时毫无意义。 */
  if (today && today.totalSec >= 30 * 60) {
    const top = [...today.rows].sort((a, b) => b.sec - a.sec)[0];
    const share = top == null ? 0 : percentOf(top.sec, today.totalSec);
    if (top != null && share >= 50) {
      out.push({ tone: 'info', text: `${shortName(top.packageName)} 占了今天的 ${share}%` });
    }
  }

  /* 「连续变多」与「最久一天」只在看最新一天时才有意义：看 11/10 说「已连续 3 天变多」
     是拿今天的趋势去描述那一天，时间线错位。 */
  const streak = isLatest ? risingStreak(days, keys) : 0;
  if (streak >= 3) {
    out.push({ tone: 'up', text: `已连续 ${streak} 天变多` });
  }

  const longest = isLatest ? longestDay(days, keys) : null;
  if (longest != null && longest.key !== lastKey) {
    out.push({
      tone: 'info',
      text: `近 ${keys.length} 天里 ${monthDayShort(longest.key)} 用得最久（${formatDuration(longest.sec)}）`,
    });
  }

  return out.slice(0, Math.max(0, limit));
}
