/**
 * TickBar 领域类型定义（Phase 2 锁定）
 * -----------------------------------------------------------------------------
 * Document ID : domain.ts
 * Status      : Frozen for Phase 3
 * Owner       : 高见远（首席架构师）
 * Upstream    : docs/phase2/IPC-CONTRACT-v2.md（DTO 与命令契约唯一依据）
 *               docs/Spec-v1.md §5 / §6
 *
 * 约定
 *  - 字段名一律 camelCase，与 Rust DTO（#[serde(rename_all = "camelCase")]）严格一一对应。
 *  - 时间戳为 epoch 毫秒（number）；时长为秒（number，向下取整）。
 *  - 本项目无网络请求；全部数据经 Tauri IPC（src/services/ipc.ts）获得。
 *
 * 重要（Spec §13 变更①，v2 契约）
 *  - TimeRecordStatus 仅 'active' | 'saved'，**已移除 'draft'**。
 *  - TimerStatus 仅 'idle' | 'running' | 'paused'，**已移除 'draft'**。
 *  - 结束计时为「右键单击 → 立即 saved」，撤销经 undo_stop 回滚为 active。
 *
 * V0.2.0 增量（docs/phase1/ARCHITECTURE-V0.2.0.md）
 *  - 新增资源类型（Note / Todo / Theme / Reminder 及其入参）见 `./domain-v020.ts`，本文件末尾 re-export。
 *  - Item 加 remindAt/remindedAt/isPinned；TimeRecord 加 mode/targetSec；TimerState 加 mode/remainingSec；
 *    Settings 加 themeMode/accents/countdownPresets。
 *  - 新增 5 错误码 / 5 事件 / 23 命令（IPC 29 → 52）。
 * -----------------------------------------------------------------------------
 */

import type {
  AccentColors,
  AccentSetParams,
  CloseNoteWindowParams,
  Note,
  NoteCreateParams,
  NoteListParams,
  NoteRefParams,
  NoteUpdateParams,
  OpenNoteWindowParams,
  Reminder,
  ReminderClearParams,
  ReminderSetParams,
  ThemeMode,
  ThemeSetParams,
  ThemeSettings,
  Todo,
  TodoCreateParams,
  TodoListParams,
  TodoRefParams,
  TodoToggleParams,
  TodoUpdateParams,
} from './domain-v020';
import type {
  CreateItemParams,
  ItemIdParams,
  ListItemsParams,
  ListRecordsParams,
  RegisterShortcutParams,
  ResolveOpenRecordParams,
  SaveWindowPositionParams,
  SetAlwaysOnTopParams,
  SetAutostartParams,
  SetCountdownPresetParams,
  StartCountdownParams,
  StartTimerParams,
  StatsSummaryParams,
  SwitchItemParams,
  UndoStopParams,
  UpdateItemParams,
  UpdateRecordParams,
  UpdateSettingsParams,
} from './domain-params';

/** epoch 毫秒时间戳（UTC） */
export type EpochMs = number;

/** 时长（秒，向下取整） */
export type Seconds = number;

/** 系统内置事项「未归类」的固定 id */
export const SYSTEM_ITEM_ID = 1;

/** 结束后撤销窗口（毫秒）。前端与 Rust 侧须一致（IPC-CONTRACT-v2 §8） */
export const UNDO_WINDOW_MS = 3000;

/** 分页默认与上限（IPC-CONTRACT-v2 §1） */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/* ===========================================================================
 * V0.2.0 常量（ARCHITECTURE-V0.2.0 §6）
 * ========================================================================= */

/** 便利贴窗口数上限（内存护栏，K-14）。超限 open_note_window 返回 WINDOW_LIMIT_EXCEEDED */
export const MAX_NOTE_WINDOWS = 20;

/** 倒计时目标上限（秒）= 24h；超限 start_countdown 返回 INVALID_TARGET_SEC */
export const MAX_COUNTDOWN_SEC = 86400;

/** 便利贴正文长度上限（字符） */
export const NOTE_CONTENT_MAX_LEN = 4000;

/** 便利贴窗口尺寸下限（逻辑像素）——硬钳制最小值 */
export const NOTE_MIN_W = 160;
export const NOTE_MIN_H = 120;

/** 便利贴窗口尺寸上限（逻辑像素）——硬钳制最大值；运行时还须再被当前屏 work_area 钳制 */
export const NOTE_MAX_W = 900;
export const NOTE_MAX_H = 900;

/** 便利贴窗口尺寸「舒适上限」（逻辑像素）——软提示，非钳制（拖拽吸附/默认建议） */
export const NOTE_COMFORT_MAX_W = 640;
export const NOTE_COMFORT_MAX_H = 480;

/** 便利贴几何（Moved/Resized）落盘去抖（毫秒，K-23） */
export const NOTE_GEOM_DEBOUNCE_MS = 300;

/** 默认倒计时预设（秒）：5 / 15 / 25 / 30 / 45 / 60 分钟 */
export const DEFAULT_COUNTDOWN_PRESETS: readonly number[] = [300, 900, 1500, 1800, 2700, 3600];

/** 主题快取键（首屏内联脚本同步读取，防白闪 K-18） */
export const THEME_CACHE_KEY = 'tickbar.theme';

/* ===========================================================================
 * 枚举（字符串联合）
 * ========================================================================= */

/**
 * 事项状态。
 * - active  ：可用
 * - archived：已归档（不计入默认列表，但保留）
 */
export type ItemStatus = 'active' | 'archived';

/**
 * 时间记录状态（会话生命周期）。
 * - active：会话进行中（endedAt === null）；runningSince 非空=计时中，为空=已暂停
 * - saved ：已结束并落盘（可被汇总 / 明细查询）
 *
 * 注意：v2 已移除 'draft'（Spec §13 变更①）。
 */
export type TimeRecordStatus = 'active' | 'saved';

/**
 * 计时器整体状态（TimerState.status）。
 * - idle   ：无进行中的会话
 * - running：会话进行中（正在计时）
 * - paused ：会话进行中但已暂停（不产生记录）
 *
 * 注意：v2 已移除 'draft'（Spec §13 变更①）。
 */
export type TimerStatus = 'idle' | 'running' | 'paused';

/**
 * 计时模式 [V0.2.0]。
 * - countup  ：正计时（V0.1.0 行为）
 * - countdown：倒计时（到点自动结束，targetSec 非空）
 */
export type TimerMode = 'countup' | 'countdown';

/** 全局快捷键动作（[P1]，本期仅保留结构与默认值，不注册实际热键） */
export type ShortcutAction = 'toggle_window' | 'start_pause' | 'stop' | 'new_item';

/** 计时中切换事项的模式 */
export type SwitchMode =
  /** 结束当前会话（saved）并新开一条归属新事项的 active 会话（分段） */
  | 'end_and_start'
  /** 仅更改当前会话归属事项，时长连续不计断 */
  | 'just_switch';

/** 崩溃恢复对话框动作 */
export type ResolveAction =
  /** 保持 active，runningSince 重置为 now（不计崩溃停机时长） */
  | 'resume'
  /** 置 saved，endedAt = endAt ?? now（不补算崩溃间隙） */
  | 'close'
  /** 软删除该会话（deletedAt=now 且 status='saved'），释放单 active 约束 */
  | 'discard';

/** 统一错误码（V0.1.0 共 11 个，IPC-CONTRACT-v2 §2；V0.2.0 +5 → 共 16） */
export type ErrorCode =
  | 'DB_ERROR'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NAME_EMPTY'
  | 'ITEM_NAME_DUPLICATE'
  | 'ITEM_SYSTEM_PROTECTED'
  | 'TIMER_ALREADY_RUNNING'
  | 'TIMER_NOT_RUNNING'
  | 'TIMER_NO_UNDO'
  | 'SHORTCUT_REGISTER_FAILED'
  | 'INVALID_DURATION'
  | 'IO_ERROR'
  /* [V0.2.0] */
  | 'NOTE_NOT_FOUND'
  | 'TODO_NOT_FOUND'
  | 'WINDOW_LIMIT_EXCEEDED'
  | 'INVALID_TARGET_SEC'
  | 'INVALID_COLOR';

/* ===========================================================================
 * 核心领域实体
 * ========================================================================= */

/** 事项（归类主体） */
export interface Item {
  /** 主键；系统事项「未归类」固定为 1 */
  id: number;
  /** 名称 */
  name: string;
  /** 标签色 hex 字符串（用户数据，非设计 token）；null = 使用主题默认 */
  color: string | null;
  /** 状态 */
  status: ItemStatus;
  /** 是否系统内置（true 仅「未归类」；不可删除 / 归档） */
  isSystem: boolean;
  /** 手动排序权重（升序） */
  sortOrder: number;
  /** [V0.2.0] 事项提醒时刻（epoch 毫秒）；null = 无提醒 */
  remindAt: EpochMs | null;
  /** [V0.2.0] 该提醒已触发时刻；null = 未触发（后台调度去重标记，K-19） */
  remindedAt: EpochMs | null;
  /** [V0.2.0] 固定任务 / 常用事项 */
  isPinned: boolean;
  /** 创建时间 */
  createdAt: EpochMs;
  /** 更新时间 */
  updatedAt: EpochMs;
}

/** 时间记录（一次计时会话） */
export interface TimeRecord {
  /** 主键 */
  id: number;
  /** 归属事项 id */
  itemId: number;
  /** 会话状态（active | saved） */
  status: TimeRecordStatus;
  /** 会话首次开始时间 */
  startedAt: EpochMs;
  /** 会话结束时间；active 时为 null */
  endedAt: EpochMs | null;
  /** 累计已计时秒数 */
  accumulatedSec: Seconds;
  /** 当前计时段起点；非 null = 计时中，null = 暂停或已结束 */
  runningSince: EpochMs | null;
  /** 备注（长度 ≤ 500）；可为空 */
  note: string | null;
  /** [V0.2.0] 计时模式（countup | countdown） */
  mode: TimerMode;
  /** [V0.2.0] 倒计时目标秒数；仅 mode='countdown' 非空 */
  targetSec: Seconds | null;
}

/** 计时器整体状态（get_timer_state 返回；timer:state-changed 事件 payload） */
export interface TimerState {
  /** 计时器状态 */
  status: TimerStatus;
  /** 进行中的会话（running / paused 时非空；idle 时为 null） */
  session: TimeRecord | null;
  /** 最近使用的事项 id（默认 1） */
  lastItemId: number | null;
  /**
   * 服务端快照的实时累计时长（秒）。
   * 计算：accumulatedSec + (status==='running' ? floor((now - runningSince)/1000) : 0)
   * 前端本地 tick 必须使用同一公式，避免同步瞬间数字跳变（IPC-CONTRACT-v2 §10 R-4）。
   */
  liveDurationSec: Seconds;
  /** [V0.2.0] 当前模式（idle 时 = 'countup'） */
  mode: TimerMode;
  /**
   * [V0.2.0] 倒计时剩余秒数 = max(0, targetSec - liveDurationSec)（服务端快照）；
   * countup / idle 时为 null。与 liveDurationSec 同源，避免同步跳变。
   */
  remainingSec: Seconds | null;
}

/** 全局快捷键映射（字符串值为 accelerator；null = 未注册） */
export interface ShortcutMap {
  /** 显示 / 隐藏悬浮条 */
  toggleWindow: string | null;
  /** 开始 / 暂停 */
  startPause: string | null;
  /** 结束当前记录 */
  stop: string | null;
  /** 新建事项 */
  newItem: string | null;
}

/** 应用设置 */
export interface Settings {
  /** 开机自启是否开启（以注册表实际状态为准，P0-6） */
  autostartEnabled: boolean;
  /** 悬浮条是否置顶 */
  alwaysOnTop: boolean;
  /** 透明度是否启用（关闭即降级为纯色圆角矩形，W-4） */
  opacityEnabled: boolean;
  /** 最近所在显示器标识；null = 未记录 */
  lastDisplayId: string | null;
  /** 全局快捷键映射（[P1]） */
  shortcuts: ShortcutMap;
  /** [V0.2.0] 主题模式（dark | light | system） */
  themeMode: ThemeMode;
  /** [V0.2.0] 四色可配（计时中 / 提醒 / 完成 / 小条底色） */
  accents: AccentColors;
  /** [V0.2.0] 倒计时预设时长（秒，升序去重） */
  countdownPresets: number[];
  /**
   * [V0.2.0 批 2] 倒计时到点「自动结束并保存」开关。
   * 默认 `false` = 仅「通知 + 视觉提示」（AC-62）；`true` = 到点自动落盘记录（时长=target）。
   */
  countdownAutoEnd: boolean;
}

/** 单事项聚合统计项 */
export interface ItemStats {
  /** 事项 id */
  itemId: number;
  /** 该事项合计时长（秒） */
  totalSec: Seconds;
}

/** 汇总统计（stats_summary 返回） */
export interface StatsSummary {
  /** 合计时长（秒） */
  totalSec: Seconds;
  /** 记录条数 */
  recordCount: number;
  /** 按事项聚合（totalSec 降序） */
  byItem: ItemStats[];
}

/** 统一失败对象（命令返回 Err 时序列化） */
export interface AppError {
  /** 错误码 */
  code: ErrorCode;
  /** 人类可读描述 */
  message: string;
}

/* ===========================================================================
 * 通用泛型
 * ========================================================================= */

/** 分页结果 */
export interface Paginated<T> {
  /** 当前页数据 */
  items: T[];
  /** 过滤后总条数 */
  total: number;
  /** 当前页码（从 1 起） */
  page: number;
  /** 每页条数 */
  limit: number;
  /** 是否还有下一页（page * limit < total） */
  hasMore: boolean;
}

/* ===========================================================================
 * 命令入参 → 已外移 ./domain-params.ts（单文件 ≤300 行纪律）
 * 含：ListItemsParams / CreateItemParams / ItemPatch / UpdateItemParams /
 *     ItemIdParams / StartTimerParams / StartCountdownParams /
 *     SetCountdownPresetParams / UndoStopParams / SwitchItemParams /
 *     ListRecordsParams / StatsSummaryParams / RecordPatch / UpdateRecordParams /
 *     ResolveOpenRecordParams / UpdateSettingsParams / SetAutostartParams /
 *     RegisterShortcutParams / SetAlwaysOnTopParams / SaveWindowPositionParams
 * ========================================================================= */

/* ===========================================================================
 * 事件 Payload（Rust -> 前端 emit）
 * ========================================================================= */

/** timer:state-changed —— 权威状态，前端应以 payload 覆盖本地 store */
export type TimerStateChangedPayload = TimerState;

/** shortcut:triggered —— [P1] 全局热键按下 */
export interface ShortcutTriggeredPayload {
  action: ShortcutAction;
}

/** [V0.2.0] countdown-finished —— 倒计时到点自动结束（前端据此播放铃声） */
export interface CountdownFinishedPayload {
  /** 已落盘的会话记录（status='saved'，accumulatedSec = targetSec） */
  session: TimeRecord;
  /** 目标秒数 */
  targetSec: Seconds;
}

/** [V0.2.0] theme-changed —— 主题/四色变更（广播所有窗口，K-21） */
export type ThemeChangedPayload = ThemeSettings & { accents: AccentColors };

/** [V0.2.0] note-window-opened / note-window-closed 载荷 */
export interface NoteWindowPayload {
  noteId: number;
}

/** 事件名常量（供 listen 使用，避免字符串散落） */
export const IPC_EVENTS = {
  timerStateChanged: 'timer:state-changed',
  shortcutTriggered: 'shortcut:triggered',
  trayToggleVisibility: 'tray:toggle-visibility',
  openSettings: 'app:open-settings',
  openNewItem: 'app:open-new-item',
  /* [V0.2.0] */
  reminderFired: 'reminder-fired',
  countdownFinished: 'countdown-finished',
  themeChanged: 'theme-changed',
  noteWindowOpened: 'note-window-opened',
  noteWindowClosed: 'note-window-closed',
  /* [V0.2.0 批2] 托盘 → 前端 IA（原生托盘菜单项触发；无前端渲染，仅通知主窗开面板） */
  openCommonItems: 'app:open-common-items',
  openNewNote: 'app:open-new-note',
} as const;

/* ===========================================================================
 * IPC 方法签名（src/services/ipc.ts 实现，仅在此声明类型）
 * ========================================================================= */

/**
 * 命令 -> Promise<返回值> 映射。
 * 命令名（Rust snake_case）与方法名（camelCase）的对应关系见
 * IPC-CONTRACT-v2 §3。实现侧不得在此签名之外新增方法（规格即契约）。
 */
export interface IpcApi {
  /* 事项域 */
  listItems(params: ListItemsParams): Promise<Item[]>;
  createItem(params: CreateItemParams): Promise<Item>;
  updateItem(params: UpdateItemParams): Promise<Item>;
  archiveItem(params: ItemIdParams): Promise<Item>;
  unarchiveItem(params: ItemIdParams): Promise<Item>;
  deleteItem(params: ItemIdParams): Promise<void>;

  /* 计时域 */
  startTimer(params: StartTimerParams): Promise<TimeRecord>;
  pauseTimer(): Promise<TimeRecord>;
  resumeTimer(): Promise<TimeRecord>;
  stopTimer(): Promise<TimeRecord>;
  undoStop(params: UndoStopParams): Promise<TimeRecord>;
  getTimerState(): Promise<TimerState>;
  switchItem(params: SwitchItemParams): Promise<TimerState>;

  /* 记录域 */
  listRecords(params: ListRecordsParams): Promise<Paginated<TimeRecord>>;
  statsSummary(params: StatsSummaryParams): Promise<StatsSummary>;
  updateRecord(params: UpdateRecordParams): Promise<TimeRecord>;
  deleteRecord(params: ItemIdParams): Promise<void>;

  /* 崩溃恢复 */
  resolveOpenRecord(params: ResolveOpenRecordParams): Promise<TimeRecord | null>;

  /* 设置域 */
  getSettings(): Promise<Settings>;
  updateSettings(params: UpdateSettingsParams): Promise<Settings>;
  setAutostart(params: SetAutostartParams): Promise<boolean>;
  getAutostart(): Promise<boolean>;

  /* 快捷键域 [P1] */
  registerShortcut(params: RegisterShortcutParams): Promise<boolean>;

  /* 窗口 / 系统域 */
  showWindow(): Promise<void>;
  hideWindow(): Promise<void>;
  toggleWindow(): Promise<void>;
  setAlwaysOnTop(params: SetAlwaysOnTopParams): Promise<void>;
  saveWindowPosition(params: SaveWindowPositionParams): Promise<void>;
  quitApp(): Promise<void>;

  /* ---------------------------------------------------------------------------
   * V0.2.0 新增（IPC 29 → 52；ARCHITECTURE-V0.2.0 §5.3）
   * ------------------------------------------------------------------------ */

  /* 待办域 [V0.2.0] */
  todoCreate(params: TodoCreateParams): Promise<Todo>;
  todoUpdate(params: TodoUpdateParams): Promise<Todo>;
  todoDelete(params: TodoRefParams): Promise<void>;
  todoList(params: TodoListParams): Promise<Todo[]>;
  todoToggle(params: TodoToggleParams): Promise<Todo>;

  /* 便利贴域 [V0.2.0] */
  noteCreate(params: NoteCreateParams): Promise<Note>;
  noteGet(params: NoteRefParams): Promise<Note>;
  noteList(params: NoteListParams): Promise<Note[]>;
  noteUpdate(params: NoteUpdateParams): Promise<Note>;
  noteDelete(params: NoteRefParams): Promise<void>;

  /* 多窗口域 [V0.2.0] */
  openNoteWindow(params: OpenNoteWindowParams): Promise<void>;
  closeNoteWindow(params: CloseNoteWindowParams): Promise<void>;
  openTodosWindow(): Promise<void>;
  openSettingsWindow(): Promise<void>;

  /* 主题域 [V0.2.0] */
  themeGet(): Promise<ThemeSettings>;
  themeSet(params: ThemeSetParams): Promise<ThemeSettings>;
  accentGet(): Promise<AccentColors>;
  accentSet(params: AccentSetParams): Promise<AccentColors>;

  /* 计时域 · 倒计时扩展 [V0.2.0] */
  startCountdown(params: StartCountdownParams): Promise<TimeRecord>;
  setCountdownPreset(params: SetCountdownPresetParams): Promise<number[]>;

  /* 提醒域 [V0.2.0] */
  reminderSet(params: ReminderSetParams): Promise<Reminder>;
  reminderClear(params: ReminderClearParams): Promise<void>;
  reminderPending(): Promise<Reminder[]>;
}

/* ===========================================================================
 * 命令入参 / Patch DTO → ./domain-params.ts（re-export，对外 import 面不变）
 * ========================================================================= */
export * from './domain-params';

/* ===========================================================================
 * V0.2.0 资源类型（Note / Todo / Theme / Reminder 及其入参）
 * 见 ./domain-v020.ts —— 单文件 ≤300 行纪律，按资源分包。
 * ========================================================================= */
export * from './domain-v020';
