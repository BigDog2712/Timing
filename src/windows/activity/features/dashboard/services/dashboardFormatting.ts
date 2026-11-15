import type { AppStat } from "../../../shared/types/app.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";

export interface CategoryDistItem {
  category: AppCategory;
  name: string;
  value: number;
  color: string;
}

export interface TopApplicationItem {
  exeName: string;
  name: string;
  color: string;
  duration: number;
  suspiciousDuration: number;
  percentage: number;
  categoryInitial: string;
}

export function formatDashboardDuration(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function getTotalTrackedTime(stats: AppStat[]) {
  return stats.reduce((total, item) => total + Math.max(0, item.totalDuration), 0);
}

/**
 * 星期短名（趋势卡的柱下标 / 热力图的行标）。`Intl` 在个别语言包缺失时可能抛，
 * 退回 `toLocaleDateString()` —— 宁可显示成日期，也不能让整张卡白屏。
 */
export function formatWeekdayShort(startMs: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(startMs));
  } catch {
    return new Date(startMs).toLocaleDateString();
  }
}

/**
 * 「MM/DD」短日期（趋势卡的 x 轴，`format::short_date` 的同一口径）。
 *
 * 为什么不用 `formatWeekdayShort`：exe 那三处轴文字是日期而不是星期
 * （`trend.rs:114`），14 根柱并排时星期名一天一个太啰嗦，日期还能读出"这是哪几天"。
 */
export function formatShortDate(startMs: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" }).format(new Date(startMs));
  } catch {
    return new Date(startMs).toLocaleDateString();
  }
}

/**
 * 星期**窄名**（热力图左侧那一列）：`narrow` 在中文里就是「一」而不是「周一」，
 * 与 Rust `format::weekday_short` 逐字一致 —— 那一列只有 16px（`heatmap.rs:28`
 * 的 `label_w`），「周一」放不进去会被省略成「周…」。
 *
 * 只给热力图用：趋势卡的下标有整格宽度，`short`（「周一」）读起来更清楚。
 */
export function formatWeekdayNarrow(startMs: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(startMs));
  } catch {
    return formatWeekdayShort(startMs, locale);
  }
}

export function buildTopApplications(stats: AppStat[]): TopApplicationItem[] {
  const totalTrackedTime = getTotalTrackedTime(stats);

  return stats.map((item) => {
    const mapped = AppClassification.mapApp(item.exeName, { appName: item.appName });
    const overrideName = AppClassification.getUserOverride(item.exeName)?.displayName?.trim();
    const name = overrideName || item.appName.trim() || mapped.name;
    return {
      exeName: item.exeName,
      name,
      color: mapped.color,
      duration: Math.max(0, item.totalDuration),
      suspiciousDuration: Math.max(0, item.suspiciousDuration),
      percentage: totalTrackedTime > 0
        ? Math.round((Math.max(0, item.totalDuration) / totalTrackedTime) * 100)
        : 0,
      categoryInitial: mapped.category[0].toUpperCase(),
    };
  });
}

export function buildCategoryDistribution(stats: AppStat[]): CategoryDistItem[] {
  const categories = new Map<AppCategory, number>();

  for (const stat of stats) {
    const mapped = AppClassification.mapApp(stat.exeName, { appName: stat.appName });
    categories.set(mapped.category, (categories.get(mapped.category) ?? 0) + Math.max(0, stat.totalDuration));
  }

  return Array.from(categories.entries())
    .map(([cat, val]) => ({
      category: cat,
      name: AppClassification.getCategoryLabelOverride(cat) ?? "",
      value: val,
      color: AppClassification.getCategoryColor(cat),
    }))
    .sort((a, b) => b.value - a.value);
}

/** 事项分布的一行：同一 `displayTitle` 的会话聚合后的结果 */
export interface TopItemEntry {
  title: string;
  duration: number;
  /** 占今日已计时总量的百分比（整数，与 `TopApplicationItem.percentage` 同口径） */
  percentage: number;
  /** 取该事项内**时长最长那条会话**的类别色，让裸条颜色与「这是哪类事」一致 */
  color: string;
  exeName: string;
}

export interface TopItemsResult {
  /** 截断后的前 N 条（卡里就画这些） */
  items: TopItemEntry[];
  /** 截断**之前**的条数。卡头「今日 N 项」用的是它，不是 `items.length` ——
   *  后者恒等于 limit，"今日 6 项"会变成一句永远正确的假话。 */
  total: number;
}

/**
 * 事项分布（01 §4.2）：`compiledSessions` 按 **`displayTitle`** 聚合 `duration`，取前 N。
 *
 * 三条口径：
 *   · **不出 IPC、不建表** —— `compiledSessions` 已经在 `DashboardReadModel` 里
 *     （`dashboardReadModel.ts:49`），这是纯函数，`useMemo` 里跑一次。
 *   · `displayTitle` 为空时退到 `displayName`（`sessionReadCompiler.ts:33-35`：前者是
 *     归一后的窗口标题，后者是应用显示名；两者都可能被用户规则改写成空串）。
 *   · 颜色取"这一事项里最长那条会话"的类别色，而不是第一条 —— 同一标题可能横跨
 *     两个应用（浏览器窗口标题 + 编辑器文件名撞名），取第一条会让颜色随机。
 */
export function buildTopItems(sessions: CompiledSession[], limit = 6): TopItemsResult {
  const buckets = new Map<string, { duration: number; longest: number; exeName: string }>();

  for (const session of sessions) {
    const title = (session.displayTitle || session.displayName || "").trim();
    if (!title) continue;
    const fallbackEnd = session.endTime ?? session.startTime;
    const duration = Math.max(0, session.duration ?? fallbackEnd - session.startTime);
    if (duration <= 0) continue;

    const bucket = buckets.get(title);
    if (bucket) {
      bucket.duration += duration;
      if (duration > bucket.longest) {
        bucket.longest = duration;
        bucket.exeName = session.exeName;
      }
    } else {
      buckets.set(title, { duration, longest: duration, exeName: session.exeName });
    }
  }

  const total = Array.from(buckets.values()).reduce((sum, bucket) => sum + bucket.duration, 0);

  const items = Array.from(buckets.entries())
    .map(([title, bucket]) => ({
      title,
      duration: bucket.duration,
      percentage: total > 0 ? Math.round((bucket.duration / total) * 100) : 0,
      color: AppClassification.mapApp(bucket.exeName).color,
      exeName: bucket.exeName,
    }))
    .sort((left, right) => right.duration - left.duration)
    .slice(0, limit);

  return { items, total: buckets.size };
}
