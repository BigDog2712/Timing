import type { AppStat } from "../../../shared/types/app.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";

export interface CategoryDistItem {
  category: AppCategory;
  name: string;
  value: number;
  color: string;
  /**
   * 这一段的百分比（整数）。**只有读模型已经算过的那一维才带**（应用维度，见
   * `focusDimension.fromApplications`）；分类 / 事项维度缺省 = 计时卡自己按
   * `value / total` 算（与 0.12.5 逐字一致）。
   *
   * 为什么不是必填：这个类型在仓里被当成"环的一段"用（计时卡的 `categoryDist` prop
   * 吃的是 `focus.slices`），两条来源都往这里灌 —— 硬要一个字段，另一条就得编一个。
   */
  percentage?: number;
}

export interface TopApplicationItem {
  exeName: string;
  name: string;
  color: string;
  duration: number;
  suspiciousDuration: number;
  percentage: number;
  categoryInitial: string;
  /**
   * [0.12.6 · P0-9] 这个应用带「工具」标签（下载器 / 终端 / 截图 / 系统维护）。
   *
   * 语义只有一条：**它不计入统计**（总量 / 分类分布 / 占比分母），但**仍在排行里出现**
   * —— 用户要能在排行上看见"我装了 IDM，它被标成工具了"，否则"我的总时长怎么少了"
   * 永远查不出来。行上的「工具」小标记读的就是这个字段。
   *
   * 为什么是**可选**：`TopApplicationItem` 在测试里是手写字面量（`AppsModule.test.tsx`），
   * 加成必填会让所有构造点一起编译失败。缺省语义 = `false`（不是工具类）。
   */
  isTool?: boolean;
}

/** `buildTopApplications` 的统计口径（缺省 = 全部应用都算，老调用点行为不变） */
export interface TopApplicationOptions {
  /**
   * 判定这一行是不是**工具类**（由调用方给出，唯一判据在 `dashboardReadModel`）。
   *
   * 为什么不在这里import `isToolTags` 自己算：统计过滤必须只有**一个实现点**
   * （`dashboardReadModel.ts`），否则"排行里的标记"与"总量里扣掉的那部分"会各判一次，
   * 两边规则一歪，用户就会看到"标了工具、总时长却没变"。
   */
  isTool?: (stat: AppStat) => boolean;
  /** 占比分母；缺省 = 本批合计。统计口径剔除工具应用时由调用方传"已计入"的合计 */
  totalDuration?: number;
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

/**
 * 应用排行（**全量**，含工具类）。
 *
 * 三条口径：
 *   · 排行本身**不筛人**：工具类应用照样出现在列表里，只是 `isTool=true`、占比记 0 ——
 *     它们已经从统计口径里被拿掉了，再给一个"占已计入时长的百分比"会算出一个 >100%
 *     的数（IDM 2h + 写代码 1h）；
 *   · 占比分母由调用方定（`options.totalDuration`）：`dashboardReadModel` 传"剔除工具类
 *     之后"的合计，于是排行里各非工具项的占比仍按统计口径细分；
 *   · 老调用点（`buildTopApplications(stats)`）不传 options → 全部 `isTool=false`、
 *     分母 = 本批合计，行为与 0.12.5 逐字一致。
 */
export function buildTopApplications(
  stats: AppStat[],
  options: TopApplicationOptions = {},
): TopApplicationItem[] {
  const isTool = options.isTool ?? (() => false);
  const totalTrackedTime = options.totalDuration ?? getTotalTrackedTime(stats);

  return stats.map((item) => {
    const mapped = AppClassification.mapApp(item.exeName, { appName: item.appName });
    const overrideName = AppClassification.getUserOverride(item.exeName)?.displayName?.trim();
    const name = overrideName || item.appName.trim() || mapped.name;
    const tool = isTool(item);
    return {
      exeName: item.exeName,
      name,
      color: mapped.color,
      duration: Math.max(0, item.totalDuration),
      suspiciousDuration: Math.max(0, item.suspiciousDuration),
      percentage: tool || totalTrackedTime <= 0
        ? 0
        : Math.round((Math.max(0, item.totalDuration) / totalTrackedTime) * 100),
      categoryInitial: mapped.category[0].toUpperCase(),
      isTool: tool,
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
