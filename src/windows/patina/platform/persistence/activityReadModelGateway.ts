import { invokeWithCommandError } from "./commandError.ts";
import { ANONYMOUS_ACTIVITY_KEY } from "../../shared/classification/anonymousActivity.ts";
import {
  isFiniteNumber,
  isNullableString,
  isPlainRecord as isRecord,
} from "../../shared/lib/runtimeTypeGuards.ts";

/*
 * 这里**故意不导出日级双口径的读方法**（`cmd_get_activity_daily_totals`）。
 * 那句命令已经存在、也有 30 天位对位用例（Rust 侧 `daily_parity_verify`），
 * 但前端目前零消费者：热力与趋势要的是**小时**格，日级表只有 `day_key` 粒度
 * （见 `bucketUnionMs` 那条注释）。`device_sum_ms` 副标会在 P4 随「历史页日卡」一起接，
 * 在那之前留一个没人调的网关方法只会让人以为 UI 已经接了。
 */
export type ActivityReadPath = "projection" | "facts" | "hybrid";

interface ActivityCatalogCursor {
  lastSeenMs: number;
  rawExeName: string;
}

interface ActivityCatalogRow {
  rawExeName: string;
  appName: string;
  lastSeenMs: number;
  hasNativeRecords: boolean;
  hasImportExactRecords: boolean;
  hasImportBucketRecords: boolean;
}

interface ActivityCatalogPage {
  rows: ActivityCatalogRow[];
  nextCursor: ActivityCatalogCursor | null;
  hasMore: boolean;
  readPath: ActivityReadPath;
  fallbackReason: string | null;
  sourceRevision: number;
}

interface ActivityAggregateRecord {
  anonymous?: boolean;
  appName: string;
  exeName: string;
  /** 归属设备。**可选**：旧快照与既有夹具没有这一项，装配泳道时按"未标注"处理 */
  deviceId?: string;
  startTime: number;
  endTime: number;
}

interface ActivityAggregateRange {
  records: ActivityAggregateRecord[];
  /**
   * 逐桶并集（后端算好的）。长度 = 桶数；没传桶边界时后端给空数组。
   *
   * 热力 / 趋势的格值**只读这里**：`records` 的起点被压到了桶起点，用它求和得到的是
   * `device_sum_ms`（两台机器各 30 分钟 = 60），而格子上该显示的是 `union_ms`（30）。
   */
  bucketUnionMs?: number[];
  readPath: ActivityReadPath;
  fallbackReason: string | null;
  sourceRevision: number;
  projectionRowCount: number;
  factRowCount: number;
  hasActiveSession: boolean;
}

function isReadPath(value: unknown): value is ActivityReadPath {
  return value === "projection" || value === "facts" || value === "hybrid";
}

function isCatalogCursor(value: unknown): value is ActivityCatalogCursor {
  return isRecord(value)
    && isFiniteNumber(value.lastSeenMs)
    && typeof value.rawExeName === "string";
}

function isCatalogRow(value: unknown): value is ActivityCatalogRow {
  return isRecord(value)
    && typeof value.rawExeName === "string"
    && typeof value.appName === "string"
    && isFiniteNumber(value.lastSeenMs)
    && typeof value.hasNativeRecords === "boolean"
    && typeof value.hasImportExactRecords === "boolean"
    && typeof value.hasImportBucketRecords === "boolean";
}

export function parseActivityCatalogPage(value: unknown): ActivityCatalogPage {
  if (!isRecord(value)
    || !Array.isArray(value.rows)
    || !value.rows.every(isCatalogRow)
    || !(value.nextCursor === null || isCatalogCursor(value.nextCursor))
    || typeof value.hasMore !== "boolean"
    || !isReadPath(value.readPath)
    || !isNullableString(value.fallbackReason)
    || !isFiniteNumber(value.sourceRevision)) {
    throw new Error("Received invalid activity catalog payload");
  }
  return value as unknown as ActivityCatalogPage;
}

function isAggregateRecord(value: unknown): value is ActivityAggregateRecord {
  return isRecord(value)
    && typeof value.appName === "string"
    && typeof value.exeName === "string"
    && (value.anonymous === undefined || typeof value.anonymous === "boolean")
    && (value.anonymous !== true || (value.exeName === "" && value.appName === ""))
    && (value.deviceId === undefined || typeof value.deviceId === "string")
    && isFiniteNumber(value.startTime)
    && isFiniteNumber(value.endTime)
    && value.endTime >= value.startTime;
}

function isBucketUnion(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => isFiniteNumber(item) && item >= 0);
}

export function parseActivityAggregateRange(value: unknown): ActivityAggregateRange {
  if (!isRecord(value)
    || !Array.isArray(value.records)
    || !value.records.every(isAggregateRecord)
    || !(value.bucketUnionMs === undefined || isBucketUnion(value.bucketUnionMs))
    || !isReadPath(value.readPath)
    || !isNullableString(value.fallbackReason)
    || !isFiniteNumber(value.sourceRevision)
    || !isFiniteNumber(value.projectionRowCount)
    || !isFiniteNumber(value.factRowCount)
    || typeof value.hasActiveSession !== "boolean") {
    throw new Error("Received invalid activity aggregate payload");
  }
  return value as unknown as ActivityAggregateRange;
}

export async function loadActivityCatalogPage(input: {
  cursor: ActivityCatalogCursor | null;
  searchQuery: string;
  limit: number;
}): Promise<ActivityCatalogPage> {
  return parseActivityCatalogPage(await invokeWithCommandError(
    "cmd_get_recorded_app_catalog_page",
    input,
  ));
}

export async function loadActivityAggregateRange(
  startMs: number,
  endMs: number,
  bucketBoundariesMs?: number[],
): Promise<ActivityAggregateRange> {
  const result = parseActivityAggregateRange(await invokeWithCommandError(
    "cmd_get_activity_aggregate_range",
    { startMs, endMs, bucketBoundariesMs: bucketBoundariesMs ?? null },
  ));
  return { ...result, records: result.records.map((record) => record.anonymous
    ? { ...record, exeName: ANONYMOUS_ACTIVITY_KEY, appName: "" } : record) };
}
