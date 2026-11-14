export interface TitleSampleDetail {
  title: string;
  startTime: number;
  endTime: number | null;
}

export interface HistorySession {
  id: number;
  appName: string;
  exeName: string;
  windowTitle: string;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  continuityGroupStartTime: number | null;
  titleSampleDetails?: TitleSampleDetail[];
  /**
   * 归属设备（设计 §6.1）。后端已在 SQL 里把哨兵与导入/匿名两支折成本机，所以有值就一定是
   * 真实 `install_id`。**可选**是刻意的：单设备时界面不许出现任何设备元素（§6.5），
   * 而"没有这个字段"与"只有一台设备"在装配泳道时应被同等对待。
   */
  deviceId?: string;
}

export interface DailySummary {
  date: string;
  totalDuration: number;
}
