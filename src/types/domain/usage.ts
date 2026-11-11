/** [0.13.0] 安卓应用使用统计的 DTO（与 Rust `models::usage` 逐字对应）。 */

export interface UsageAggregate {
  packageName: string;
  /** 当天累计前台秒数 */
  sec: number;
  /** 当天第一次进入前台的毫秒时刻（0 = 未知） */
  first: number;
  /** 当天最后一次离开前台的毫秒时刻（0 = 未知） */
  last: number;
}

export interface UsageDayDto {
  /** 这个平台有没有这个能力：桌面 false（页面据此不显示入口） */
  supported: boolean;
  /** 本地日 yyyy-MM-dd */
  date: string;
  totalSec: number;
  rows: UsageAggregate[];
}
