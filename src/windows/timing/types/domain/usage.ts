/** [0.13.0] 安卓应用使用统计的 DTO（与 Rust `models::usage` 逐字对应）。 */

/**
 * 一段前台使用（`[from, to)`，毫秒时刻）。
 *
 * 这是「9:00-9:30、10:00-10:10」的原始形状：一次连续前台一条。界面上要合并
 * 重叠/相接的段之后再显示（`mergeSpans`）—— 后端读出时已经合并过一次，但浏览器
 * mock 与旧回值不受那个保证。
 */
export interface UsageSpan {
  from: number;
  to: number;
}

export interface UsageAggregate {
  packageName: string;
  /** 当天累计前台秒数 */
  sec: number;
  /** 当天第一次进入前台的毫秒时刻（0 = 未知） */
  first: number;
  /** 当天最后一次离开前台的毫秒时刻（0 = 未知） */
  last: number;
  /**
   * 系统给的应用显示名（`PackageManager.getApplicationLabel`）。空串 = 不知道（包已卸载）。
   * **可选**是为了兼容浏览器 mock 与旧回值：调用方一律走 `displayName()`，不自己判空。
   */
  label?: string;
  /** `data:image/webp;base64,…` 的 64px 图标；空串 = 没有（前端画首字瓦片） */
  icon?: string;
  /**
   * 这天的使用时段（按时间升序、已合并）。**可选**：老日期系统已回收明细、
   * 或回值来自浏览器 mock 时就没有这个键；调用方一律走 `spansOf()` 归一，不自己判。
   */
  spans?: UsageSpan[];
}

export interface UsageDayDto {
  /** 这个平台有没有这个能力：桌面 false（页面据此不显示入口） */
  supported: boolean;
  /** 本地日 yyyy-MM-dd */
  date: string;
  totalSec: number;
  rows: UsageAggregate[];
}
