/**
 * Timing — IPC 契约面（事件名 + 方法签名）
 * -----------------------------------------------------------------------------
 * 从 `types/domain.ts` 拆出（ADR-017）。三处实现必须与本文件一致：
 *   1. 本文件 `IpcApi`（方法名 camelCase）
 *   2. `src/services/ipc.ts`（invoke 的字符串 snake_case）
 *   3. `src-tauri/src/lib.rs` 的 `generate_handler!`
 * `npm run check:contract` 机械校验，不一致即非零退出。
 */
import type { UsageDayDto } from './usage';
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
  ThemeSetParams,
  ThemeSettings,
  Todo,
  TodoCreateParams,
  TodoListParams,
  TodoRefParams,
  TodoToggleParams,
  TodoUpdateParams,
} from '../domain-v020';
import type {
  CreateItemParams,
  ItemIdParams,
  ListItemsParams,
  ListRecordsParams,
  ResolveOpenRecordParams,
  SaveWindowPositionParams,
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
} from '../domain-params';
import type {
  Item,
  Paginated,
  ReferenceSettings,
  ReferenceSettingsPatch,
  Settings,
  StatsSummary,
  StopResult,
  TimeRecord,
  TimerState,
  WindowRectDip,
  WorkAreaDip,
} from './models';
import type { PluginListResult } from './plugin';
import type { MdSyncConfig, MdSyncKind, MdSyncReport } from './mdSync';
import type {
  MdBackupExport,
  MdBackupItem,
  MdBackupRestoreResult,
  MdSyncTestResult,
  MdSyncViewCloud,
} from './mdCloud';
import type { OverlayStatus, OverlayStyle, SafStatus } from './mobile';
import type { DataRootInfo } from './dataRoot';
import type { MigrationInfo } from './migration';

/**
 * 事件名常量（供 listen 使用，避免字符串散落）。
 *
 * 每个键都必须有 Rust 侧 emit 来源——`check:contract` 会把「前端声明了、后端
 * 从不 emit」判为死常量（`EVENT_ALLOWLIST` 目前为空；V0.3.3 随全局快捷键下架
 * 清掉了唯一的例外 `shortcut:triggered`）。
 */
export const IPC_EVENTS = {
  timerStateChanged: 'timer:state-changed',
  /* [V0.3.1] 托盘双击：高亮定位小条（颜色取设置里的「高亮颜色」）。
     原 `tray:toggle-visibility` 随「显示 / 隐藏」功能一起删除。 */
  trayHighlight: 'tray:highlight',
  openNewItem: 'app:open-new-item',
  /* [V0.2.0] */
  reminderFired: 'reminder-fired',
  /* [V0.3.12] 待办两级提醒（stage=1 轻提醒 / stage=2 自动开始询问，ADR-030） */
  todoNudge: 'todo-nudge',
  countdownFinished: 'countdown-finished',
  themeChanged: 'theme-changed',
  noteWindowOpened: 'note-window-opened',
  noteWindowClosed: 'note-window-closed',
  /* [V0.2.0 批2] 托盘 → 前端 IA（原生托盘菜单项触发；无前端渲染，仅通知主窗开面板） */
  openNewNote: 'app:open-new-note',
  /* [V0.4.0] Markdown 同步把文件改动写回 SQL 后广播 */
  mdSyncChanged: 'md-sync:changed',
} as const;

/* ---- [P0-03] 宿主 → 分析窗的一次性落点（`open_patina_window` 的可选参数） ----
命名口径（FUSION-ARCH-v1 §6.6）：药丸窗口 label 是 `main`，分析窗是 `patina`——与 Rust
insight 侧的定义相反。本类型描述「分析窗该落到哪里」，不是「哪个窗口」。 */
export interface PatinaHistoryTarget {
  /** 本地日 `YYYY-MM-DD`（`src/lib/dateKey.ts` 的 `todayDateKey()`；禁用 UTC 截断） */
  dateKey: string;
  /** 可选：想在分析窗里聚焦的应用名（`History` 侧以高亮环消费，不做过滤/不滚动定位）。 */
  focusApp?: string | null;
}

export interface PatinaOpenTarget {
  history?: PatinaHistoryTarget; /* 历史页某天；与 overview 二选一（并存时 history 优先） */
  overview?: boolean; /* `true` = 分析窗总览页（P1-02：摘要面板页脚「在分析窗看总览」） */
  /* [V0.12.1][依赖 T03] `true` = 分析窗设置页。三键互斥，判序 history > settings > overview；
     Rust 侧 `PatinaOpenTarget` 是 deny_unknown_fields，T03 同批补这个字段之前会被拒收。 */
  settings?: boolean;
}

export interface PatinaOpenWindowParams {
  /** 省略 = 只把分析窗叫到前台（V0.12.0 原行为） */
  target?: PatinaOpenTarget | null;
}

/**
 * 命令 -> Promise<返回值> 映射。实现侧不得在此签名之外新增方法（规格即契约）。
 */
export interface IpcApi {
  dailyStatusGet(date: string): Promise<Record<number, 'pending' | 'done'>>;
  dailyStatusSet(date: string, itemId: number, status: 'pending' | 'done'): Promise<void>;
  /** [0.13.0] 安卓应用使用统计（桌面 supported:false；未授权抛 USAGE_PERMISSION_DENIED） */
  usageStatsGet(date: string): Promise<UsageDayDto>;
  usageStatsSettings(): Promise<void>;

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
  /** [V0.3.4] 返回 `discarded`：低于最短记录时长时已软删除，前端不展示撤销条 */
  stopTimer(): Promise<StopResult>;
  discardTimer(): Promise<void>;
  undoStop(params: UndoStopParams): Promise<TimeRecord>;
  getTimerState(): Promise<TimerState>;
  switchItem(params: SwitchItemParams): Promise<TimerState>;

  /* 记录域 */
  listRecords(params: ListRecordsParams): Promise<Paginated<TimeRecord>>;
  createRecord(params: { itemId: number; startedAt: number; endedAt: number; note?: string | null }): Promise<TimeRecord[]>;
  statsSummary(params: StatsSummaryParams): Promise<StatsSummary>;
  updateRecord(params: UpdateRecordParams): Promise<TimeRecord>;
  deleteRecord(params: ItemIdParams): Promise<void>;

  /* 崩溃恢复 */
  resolveOpenRecord(params: ResolveOpenRecordParams): Promise<TimeRecord | null>;

  /* 设置域 */
  getSettings(): Promise<Settings>;
  updateSettings(params: UpdateSettingsParams): Promise<Settings>;
  getReferenceSettings(): Promise<ReferenceSettings>;
  updateReferenceSettings(params: { patch: ReferenceSettingsPatch }): Promise<ReferenceSettings>;
  setAutostart(params: SetAutostartParams): Promise<boolean>;
  getAutostart(): Promise<boolean>;

  /* 窗口 / 系统域 */
  showWindow(): Promise<void>;
  /** 主窗所在显示器的工作区（DIP），前端 auto-fit 的布局上界（ADR-020） */
  mainWorkArea(): Promise<WorkAreaDip>;
  /** 主条矩形（DIP）：便利贴「默认落在小条附近」的基准（V0.3.1） */
  mainWindowRect(): Promise<WindowRectDip>;
  hideWindow(): Promise<void>;
  toggleWindow(): Promise<void>;
  saveWindowPosition(params: SaveWindowPositionParams): Promise<void>;
  quitApp(): Promise<void>;

  /* 待办域 [V0.2.0] */
  todoCreate(params: TodoCreateParams): Promise<Todo>;
  todoUpdate(params: TodoUpdateParams): Promise<Todo>;
  todoDelete(params: TodoRefParams): Promise<void>;
  todoList(params: TodoListParams): Promise<Todo[]>;
  todoToggle(params: TodoToggleParams): Promise<Todo>;
  /** [V0.3.12] 待办 → 计时：开始计时并立刻把这条待办移出待办区（ADR-030） */
  todoStart(params: TodoRefParams): Promise<TimeRecord>;

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
  openTimerWindow(): Promise<void>;
  /* [V0.12.0 Patina 融合] 打开时间统计窗口（label `patina`，同一进程内的第二个入口）。
     桌面独占：Patina 依赖 WebView2 / Win32，Android 上根本编不进来。
     [P0-03] 加**可选**落点参数（命令名不变 → 宿主命令数仍 80 条）。 */
  openPatinaWindow(params?: PatinaOpenWindowParams): Promise<void>;
  /* [V0.3.4] 原日记域四条命令随日记模块整体下架删除，见 ADR-023。 */

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

  /* 插件域 [V0.3.2] —— 声明式插件：读插件目录下的启动头 plugin.json */
  pluginList(): Promise<PluginListResult>;
  pluginOpenDir(): Promise<void>;

  /* Markdown 同步 [V0.4.0 / 插件 API v2] */
  mdSyncGet(): Promise<MdSyncViewCloud>;
  /**
   * [V0.11.13] `secret` 三分语义（后端据此定，见 `commands/md_credential.rs`）：
   * `Some("")` = 清空已存密码；`Some(pw)` = 写入新密码；`null`/缺省 = **不动**已有密文。
   * 密码不进 `MdSyncConfig`、不进 `settings` 表、不回传明文（只有 `hasSecret`）。
   */
  mdSyncSave(params: { config: MdSyncConfig; secret?: string | null }): Promise<MdSyncViewCloud>;
  mdSyncRun(): Promise<MdSyncReport>;
  mdSyncOpen(params: { kind: MdSyncKind }): Promise<void>;
  /** [V0.11.13] 测试云端连接；`secret` 缺省 = 用已存密文，空串 = 明确「没填密码」 */
  mdSyncTest(params: { config: MdSyncConfig; secret?: string | null }): Promise<MdSyncTestResult>;
  /** [V0.11.13] 备份列表；手机端同名命令回 `MD_SYNC_CONFIG_INVALID`（不支持） */
  mdBackupList(): Promise<MdBackupItem[]>;
  /** [V0.11.13] 用一份备份覆盖回去；`target` 缺省 = 按备份文件名推出来的归属 */
  mdBackupRestore(params: { name: string; target?: string | null }): Promise<MdBackupRestoreResult>;
  /** [V0.11.15] 用系统默认程序打开一份备份；失败回 `IO_ERROR` + 原文（文件已被删 / 名字不合法） */
  mdBackupOpen(params: { name: string }): Promise<void>;
  /**
   * [V0.11.23] 导出一份备份到用户挑的位置（`ACTION_CREATE_DOCUMENT`）。
   * 手机专属；桌面回 `IO_ERROR`「仅手机端可用」。用户取消 → `saved: false`，**不是错误**。
   */
  mdBackupExport(params: { name: string }): Promise<MdBackupExport>;

  /* 数据根 [V0.11.15]（PRD 4.2）—— 桌面独占，手机端三条回 `IO_ERROR`（「仅桌面端可用」）。
     命令层一次都不判路径，判据全在 Rust 的 `services::data_root`。 */
  dataRootGet(): Promise<DataRootInfo>;
  /** `path` 为 `null` = **撤销**待生效的切换（不是「没传参」，见设计 §8-4） */
  dataRootChange(params: { path?: string | null }): Promise<DataRootInfo>;
  /** 资源管理器打开当前数据根；目录不存在回 `IO_ERROR`，**不创建**目录 */
  dataRootOpen(): Promise<void>;

  /* -- 手机端原生能力 [V0.12.0]：SAF 目录 / 悬浮条。桌面调用会回 IO_ERROR --
     存在即「这端有这套能力」，不存在由 isTauri/IS_MOBILE 分支兜住；
     不要把「未授权」当成「不支持」——那是两种完全不同的处理。 */
  mdSafPick(): Promise<SafStatus>;
  mdSafStatus(): Promise<SafStatus>;
  overlaySet(params: { enabled: boolean; style?: OverlayStyle }): Promise<OverlayStatus>;
  overlayStatus(): Promise<OverlayStatus>;

  /* 迁移可见性 [V0.5.0] —— 命令 65 → 67（ADR-037）。
     两条都无入参：路径由后端重算，绝不接受前端传路径（防「改 marker 文件 →
     打开任意目录」的路径注入；marker 是用户目录下的明文 JSON）。 */
  getMigrationInfo(): Promise<MigrationInfo>;
  /** 资源管理器打开旧数据目录；目录不存在返回 `IO_ERROR`，**不创建**目录 */
  openLegacyDir(): Promise<void>;
}
