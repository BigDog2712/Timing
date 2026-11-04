/**
 * Timing — 领域模型（枚举 / 实体 / 统计 / 事件载荷）
 * -----------------------------------------------------------------------------
 * 从 `types/domain.ts` 拆出（ADR-017）。字段名一律 camelCase，与 Rust DTO 的
 * `#[serde(rename_all = "camelCase")]` 严格一一对应；时间戳 epoch 毫秒，时长秒。
 */
import type { EpochMs, Seconds } from './constants';
import type { AccentColors, ThemeMode, ThemeSettings } from '../domain-v020';

/* ===========================================================================
 * 枚举（字符串联合）
 * ========================================================================= */

export type ItemStatus = 'active' | 'archived';

/** 时间记录状态（v2 已移除 'draft'） */
export type TimeRecordStatus = 'active' | 'saved';

/** 计时器整体状态（v2 已移除 'draft'） */
export type TimerStatus = 'idle' | 'running' | 'paused';

/** 计时模式：countup 正计时 / countdown 倒计时 */
export type TimerMode = 'countup' | 'countdown';

/** 计时中切换事项的模式 */
export type SwitchMode =
  /** 结束当前会话并新开一条归属新事项的 active 会话（分段） */
  | 'end_and_start'
  /** 仅更改归属，时长连续不计断 */
  | 'just_switch';

/** 崩溃恢复对话框动作 */
export type ResolveAction = 'resume' | 'close' | 'discard';

/** 统一错误码（16 个；与 Rust `error.rs::as_str` 逐字一致，check:contract 校验） */
export type ErrorCode =
  | 'DB_ERROR'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NAME_EMPTY'
  | 'ITEM_SYSTEM_PROTECTED'
  | 'TIMER_ALREADY_RUNNING'
  | 'TIMER_NOT_RUNNING'
  | 'TIMER_NO_UNDO'
  | 'INVALID_DURATION'
  | 'IO_ERROR'
  /* [V0.2.0] */
  | 'NOTE_NOT_FOUND'
  | 'TODO_NOT_FOUND'
  | 'WINDOW_LIMIT_EXCEEDED'
  | 'INVALID_TARGET_SEC'
  | 'INVALID_COLOR'
  /* [V0.3.0] */
  | 'ITEM_NAME_TOO_LONG'
  /* [V0.4.0] */
  | 'MD_SYNC_CONFIG_INVALID';

/* ===========================================================================
 * 核心领域实体
 * ========================================================================= */

/** 事项（归类主体） */
export interface Item {
  /** 主键；系统事项「未归类」固定为 1 */
  id: number;
  name: string;
  /** 标签色 hex（用户数据，非设计 token）；null = 主题默认 */
  color: string | null;
  status: ItemStatus;
  /** 系统内置（仅「未归类」；不可删除 / 归档） */
  isSystem: boolean;
  /** 手动排序权重（升序） */
  sortOrder: number;
  /** [V0.2.0] 事项提醒时刻；null = 无提醒 */
  remindAt: EpochMs | null;
  /** [V0.2.0] 提醒已触发时刻（去重标记，K-19） */
  remindedAt: EpochMs | null;
  /** [V0.2.0] 固定任务 / 常用事项 */
  isPinned: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** 时间记录（一次计时会话） */
export interface TimeRecord {
  id: number;
  itemId: number;
  status: TimeRecordStatus;
  /** 会话首次开始时间 */
  startedAt: EpochMs;
  /** 结束时间；active 时为 null */
  endedAt: EpochMs | null;
  /** 累计已计时秒数 */
  accumulatedSec: Seconds;
  /** 当前计时段起点；非 null = 计时中，null = 暂停或已结束 */
  runningSince: EpochMs | null;
  /** 备注（≤500） */
  note: string | null;
  /** [V0.2.0] 计时模式 */
  mode: TimerMode;
  /** [V0.2.0] 倒计时目标秒数；仅 countdown 非空 */
  targetSec: Seconds | null;
}

/**
 * [V0.3.4] 手动结束计时的结果（`stop_timer` 返回）。
 *
 * `discarded = true` 表示这次计时短于「最短记录时长」（`ReferenceSettings.minRecordSeconds`），
 * 已按软删除处理：记录不在列表里，前端也不展示撤销条——短到不值得留的会话
 * 不该再让用户做一次选择（ADR-023）。
 */
export interface StopResult {
  record: TimeRecord;
  /** 低于最短记录时长 → 已软删除，前端不展示撤销条 */
  discarded: boolean;
}

/** 计时器整体状态（get_timer_state 返回；timer:state-changed 事件 payload） */
export interface TimerState {
  status: TimerStatus;
  /** 进行中的会话（running / paused 非空；idle 为 null） */
  session: TimeRecord | null;
  /** 最近使用的事项 id */
  lastItemId: number | null;
  /**
   * 服务端快照的实时累计秒。
   * 前端本地 tick 必须用同一公式（R-4 / R8 黄金用例锁定）。
   */
  liveDurationSec: Seconds;
  /** [V0.2.0] 当前模式（idle 时 = countup） */
  mode: TimerMode;
  /** [V0.2.0] 倒计时剩余秒 = max(0, targetSec - liveDurationSec)；countup/idle 为 null */
  remainingSec: Seconds | null;
}

/** Timing v1.7.3 参考设置（独立于现有 Settings） */
export interface ReferenceSettings {
  uiScale: number; plateOpacity: number; defaultCountdownMinutes: number; maxMinutes: number;
  autoWriteOnStop: boolean; autoBindFirstTodo: boolean; defaultPauseReason: string; mergeGapMinutes: number;
  minRecordSeconds: number; pendingEnabled: boolean; remindAdvanceMinutes: number; lightRemindDefaultOn: boolean;
  quickFindEnabled: boolean; timerWindowEnabled: boolean; extensionAutoStart: boolean; highlightColor: string;
  desktopMenuEnabled: boolean;
}

export interface ReferenceSettingsPatch extends Partial<ReferenceSettings> {}

/**
 * [V0.3.9] 常用摸鱼条目（应用内置，顺序即展示顺序）。
 *
 * 与 Rust `models::moyu::MoyuPreset` 一一对应；持久化在 settings KV 的
 * `moyu.presets`（JSON 数组）。`mode = countup` 时 `minutes` 只是占位，不生效。
 */
export interface MoyuPreset {
  /** 稳定标识（新建时由前端生成） */
  id: string;
  /** 事项名（≤ 40 字符） */
  item: string;
  /** 目标分钟数（1..1440） */
  minutes: number;
  mode: TimerMode;
}

/** 应用设置 */
export interface Settings {
  /** 开机自启（以注册表实际状态为准，P0-6） */
  autostartEnabled: boolean;
  /** 最近所在显示器标识 */
  lastDisplayId: string | null;
  /** [V0.2.0] 主题模式 */
  themeMode: ThemeMode;
  /** [V0.2.0] 四色可配 */
  accents: AccentColors;
  /** [V0.2.0] 倒计时预设时长（秒，升序去重） */
  countdownPresets: number[];
  /** [V0.3.9] 常用摸鱼（应用内置，不走插件） */
  moyuPresets: MoyuPreset[];
  /** [V0.3.9] 常用事项框是否展示「最近编辑」 */
  itemsShowRecent: boolean;
  /** [V0.3.9] 最近编辑展示条数（1..10） */
  itemsRecentCount: number;
  /** [V0.3.9] 常用事项默认倒计时（itemId → 分钟）：有值 = 点它起倒计时，无值 = 正计时 */
  itemsTimers: Record<string, number>;
}

/** 单事项聚合统计项 */
export interface ItemStats {
  itemId: number;
  totalSec: Seconds;
}

/** 汇总统计（stats_summary 返回） */
export interface StatsSummary {
  totalSec: Seconds;
  recordCount: number;
  /** 按事项聚合（totalSec 降序） */
  byItem: ItemStats[];
}

/** 统一失败对象（命令返回 Err 时序列化） */
export interface AppError {
  code: ErrorCode;
  message: string;
}

/** 分页结果 */
export interface Paginated<T> {
  items: T[];
  /** 过滤后总条数 */
  total: number;
  page: number;
  limit: number;
  /** page * limit < total */
  hasMore: boolean;
}

/* ===========================================================================
 * 事件 Payload（Rust -> 前端 emit）
 * ========================================================================= */

/** timer:state-changed —— 权威状态，前端以 payload 覆盖本地 store */
export type TimerStateChangedPayload = TimerState;

/** [V0.2.0] countdown-finished —— 倒计时到点（前端据此播铃声） */
export interface CountdownFinishedPayload {
  /** 已落盘的会话（status='saved'，accumulatedSec = targetSec） */
  session: TimeRecord;
  targetSec: Seconds;
}

/** [V0.2.0] theme-changed —— 主题/四色变更（广播所有窗口，K-21） */
export type ThemeChangedPayload = ThemeSettings & { accents: AccentColors };

/** [V0.2.0] note-window-opened / note-window-closed 载荷 */
export interface NoteWindowPayload {
  noteId: number;
}

/* ===========================================================================
 * 日记 DTO —— [V0.3.4] 已随日记域整体下架删除
 * ========================================================================= */

/* ===========================================================================
 * 窗口几何 DTO（ADR-020：删掉固定画布后，前端拿真实工作区当布局上界）
 * ========================================================================= */

/** 显示器工作区，DIP / 逻辑像素，与 Rust `models::common::WorkAreaDip` 一一对应 */
export interface WorkAreaDip {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 某扇窗口的矩形（DIP），与 Rust `models::common::WindowRectDip` 一一对应。
 *  目前只有主条（label `main`）用：便利贴据此「默认落在小条附近」。 */
export type WindowRectDip = WorkAreaDip;
