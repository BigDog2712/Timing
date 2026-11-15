/** [0.13.0] 安卓应用使用统计的 DTO（与 Rust `models::usage` 逐字对应）。 */

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
}

export interface UsageDayDto {
  /** 这个平台有没有这个能力：桌面 false（页面据此不显示入口） */
  supported: boolean;
  /** 本地日 yyyy-MM-dd */
  date: string;
  totalSec: number;
  rows: UsageAggregate[];
}
