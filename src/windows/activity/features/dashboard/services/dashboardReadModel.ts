import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { isToolTags } from "../../../shared/classification/toolTag.ts";
import type { AppStat } from "../../../shared/types/app.ts";
import type { HistorySession } from "../../../shared/types/sessions.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
import {
  getDashboardIconRuntimeCacheSnapshot,
  loadDashboardIconsForExecutables,
} from "./dashboardIconRuntimeCache.ts";
import {
  buildCategoryDistribution,
  buildTopApplications,
  getTotalTrackedTime,
  type CategoryDistItem,
  type TopApplicationItem,
} from "./dashboardFormatting.ts";
import {
  buildHourlyCategoryActivity,
  type HourlyActivityPoint,
  type HourlyCategoryActivity,
} from "../../../shared/lib/hourlyActivityCompiler.ts";
import {
  buildNormalizedAppStats,
  getDayRange,
  type CompiledSession,
} from "../../../shared/lib/sessionReadCompiler.ts";
import {
  buildReadModelDiagnostics,
  compileForRange,
  resolveLiveCutoffMs,
  type ReadModelDiagnostics,
} from "../../../shared/lib/readModelCore.ts";
import { loadActivityAggregateRange } from "../../../platform/persistence/activityReadModelGateway.ts";

export interface DashboardSnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
  activityRecords: AggregateSessionRecord[];
  yesterdayActivityRecords: AggregateSessionRecord[];
  hasActiveSession: boolean;
}

interface IconSnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
}

export interface DashboardReadModel {
  compiledSessions: CompiledSession[];
  /**
   * **全量**的应用统计（含工具类）。
   *
   * 注意口径：下面那些聚合（`totalTrackedTime` / `categoryDist` / `topApplications` 的
   * 占比分母）都**不吃**它，而是吃"剔除工具类之后"的那一份（见 `splitToolStats`）。
   * 这里保留全量只是为了"这个应用今天到底用了多久"这类逐行事实不被统计口径改写。
   */
  stats: AppStat[];
  totalTrackedTime: number;
  yesterdayTrackedTime: number;
  dayDeltaTrackedTime: number;
  /**
   * 应用排行（**全量，先排序后由组件截断**）：工具类应用仍在列表里，只是 `isTool=true`。
   * 见 `buildTopApplications` —— 它们照样显示时长，但不参与占比。
   */
  topApplications: TopApplicationItem[];
  hourlyActivity: HourlyActivityPoint[];
  hourlyCategoryActivity: HourlyCategoryActivity;
  categoryDist: CategoryDistItem[];
  /**
   * [P0-9] 被「工具」标签排除在统计之外的时长（毫秒）。
   *
   * 为什么留这个数：分布/总量里"消失"的那部分必须能被解释。卡上将来要写
   * 「另有 1h20m 工具类未计入」，就得有这个数；没有它，用户只能怀疑是坏了。
   * 可选是为了别的构造点（测试里的最小读模型）不必跟着补字段。
   */
  excludedToolTime?: number;
  diagnostics: ReadModelDiagnostics;
}

interface DashboardSnapshotDependencies {
  now: () => number;
  getActivityAggregateRange: typeof loadActivityAggregateRange;
  loadIcons: typeof loadDashboardIconsForExecutables;
  getCachedIcons: typeof getDashboardIconRuntimeCacheSnapshot;
}

const DASHBOARD_SNAPSHOT_DEPENDENCIES: DashboardSnapshotDependencies = {
  now: Date.now,
  getActivityAggregateRange: loadActivityAggregateRange,
  loadIcons: loadDashboardIconsForExecutables,
  getCachedIcons: getDashboardIconRuntimeCacheSnapshot,
};

function collectDashboardIconExecutables(
  ...sessionGroups: Array<Array<Pick<HistorySession, "exeName">>>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const sessions of sessionGroups) {
    for (const session of sessions) {
      const exeName = session.exeName.trim();
      if (!exeName || seen.has(exeName)) continue;

      seen.add(exeName);
      result.push(exeName);
    }
  }

  return [...new Set(result.flatMap((key) => [key, AppClassification.resolveStatisticalApp(key)]))];
}

export async function loadDashboardSnapshotWithDeps(
  date: Date,
  deps: DashboardSnapshotDependencies,
): Promise<DashboardSnapshot> {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayRange = getDayRange(date);
  const yesterdayRange = getDayRange(yesterday);
  const [dayResponse, yesterdayResponse] = await Promise.all([
    deps.getActivityAggregateRange(dayRange.startMs, dayRange.endMs),
    deps.getActivityAggregateRange(yesterdayRange.startMs, yesterdayRange.endMs),
  ]);
  const icons = await deps.loadIcons(
    collectDashboardIconExecutables(dayResponse.records),
  ).catch((error: unknown) => {
    console.warn("Failed to refresh dashboard icons:", error);
    return deps.getCachedIcons();
  });

  return {
    fetchedAtMs: deps.now(),
    icons,
    activityRecords: dayResponse.records,
    yesterdayActivityRecords: yesterdayResponse.records,
    hasActiveSession: dayResponse.hasActiveSession,
  };
}

export async function loadDashboardSnapshot(date: Date = new Date()): Promise<DashboardSnapshot> {
  return loadDashboardSnapshotWithDeps(date, DASHBOARD_SNAPSHOT_DEPENDENCIES);
}

export async function loadIconSnapshotWithDeps(
  exeNames: string[],
  deps: Pick<DashboardSnapshotDependencies, "now" | "loadIcons" | "getCachedIcons">,
): Promise<IconSnapshot> {
  const icons = exeNames.length > 0
    ? await deps.loadIcons(exeNames)
    : deps.getCachedIcons();

  return {
    fetchedAtMs: deps.now(),
    icons,
  };
}

export async function loadIconSnapshot(exeNames: string[] = []): Promise<IconSnapshot> {
  return loadIconSnapshotWithDeps(exeNames, DASHBOARD_SNAPSHOT_DEPENDENCIES);
}

export function buildDashboardReadModel(
  activityRecords: AggregateSessionRecord[],
  trackerHealth: TrackerHealthSnapshot,
  nowMs: number,
  yesterdayActivityRecords: AggregateSessionRecord[] = [],
): DashboardReadModel {
  const dayRange = getDayRange(new Date(nowMs), nowMs);
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayRange = getDayRange(yesterday);
  const compiledSessions = compileForRange(materializeActivityRecords(activityRecords), dayRange, 0);
  const compiledYesterdaySessions = compileForRange(materializeActivityRecords(yesterdayActivityRecords), yesterdayRange, 0);
  const stats = buildNormalizedAppStats(compiledSessions);
  const yesterdayStats = buildNormalizedAppStats(compiledYesterdaySessions);
  /* [P0-9] 统计口径的唯一分叉点：工具类应用在这里被摘出去，下面的四个消费点
     （总量 / 环比 / 分布 / 排行占比）全部只吃 `counted`。排行本身仍吃全量 ——
     工具应用要能被看见（见 `buildTopApplications` 的 `isTool`）。 */
  const toolSplit = splitToolStats(stats);
  const yesterdayCounted = splitToolStats(yesterdayStats).counted;
  const totalTrackedTime = getTotalTrackedTime(toolSplit.counted);
  const yesterdayTrackedTime = getTotalTrackedTime(yesterdayCounted);
  const diagnostics = buildReadModelDiagnostics(
    compiledSessions,
    trackerHealth,
    resolveLiveCutoffMs(trackerHealth, nowMs),
  );
  const hourlyCategoryActivity = buildHourlyCategoryActivity(compiledSessions);
  const hourlyActivity = hourlyCategoryActivity.points.map(({ hour, minutes }) => ({
    hour,
    minutes,
  }));

  return {
    compiledSessions,
    stats,
    totalTrackedTime,
    yesterdayTrackedTime,
    dayDeltaTrackedTime: totalTrackedTime - yesterdayTrackedTime,
    topApplications: buildTopApplications(stats, {
      isTool: isToolStat,
      /* 分母 = 已计入的合计：工具类已经被拿掉了，再拿全量当分母会算出一个 >100% 的数 */
      totalDuration: totalTrackedTime,
    }),
    hourlyActivity,
    hourlyCategoryActivity,
    categoryDist: buildCategoryDistribution(toolSplit.counted),
    excludedToolTime: getTotalTrackedTime(toolSplit.toolExcluded),
    diagnostics,
  };
}

/**
 * 一个统计行是不是**工具类**（「工具」或「工具/…」标签）。
 *
 * 取标签的键必须与 `AppsModule` 行上那两处一致：先走
 * `AppClassification.resolveStatisticalApp`（trim + 小写 + 应用关联），再取标签。
 * 少了这一步，`Code.exe` 这种保留原始大小写的统计行会查不到 `code.exe` 上的标签
 * —— 与 0.12.1 S1（绑定存上了、行上没标记）是同一个坑。
 */
function isToolStat(stat: AppStat): boolean {
  const key = AppClassification.resolveStatisticalApp(stat.exeName);
  return isToolTags(AppClassification.getAppTags(key));
}

interface ToolStatSplit {
  /** 参与统计的应用（工具类已剔除） */
  counted: AppStat[];
  /** 工具类应用：不进统计，但**仍在排行里显示** */
  toolExcluded: AppStat[];
}

/** 按「工具」标签把应用统计切成两份（统计过滤的唯一实现点）。 */
function splitToolStats(stats: readonly AppStat[]): ToolStatSplit {
  const counted: AppStat[] = [];
  const toolExcluded: AppStat[] = [];
  for (const stat of stats) {
    if (isToolStat(stat)) {
      toolExcluded.push(stat);
      continue;
    }
    counted.push(stat);
  }
  return { counted, toolExcluded };
}

function materializeActivityRecords(buckets: AggregateSessionRecord[]): HistorySession[] {
  return buckets.map((bucket, index) => ({
    id: -(index + 1),
    appName: bucket.appName,
    exeName: bucket.exeName,
    windowTitle: "",
    startTime: bucket.startTime,
    endTime: bucket.endTime,
    duration: Math.max(0, bucket.endTime - bucket.startTime),
    continuityGroupStartTime: bucket.startTime,
  }));
}
