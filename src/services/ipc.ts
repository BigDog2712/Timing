/**
 * Timing — IPC 唯一出口（K-11）
 * -----------------------------------------------------------------------------
 * 契约：docs/phase2/IPC-CONTRACT-v2.md §3；类型：src/types/domain.ts（IpcApi）。
 * 规则（硬）：
 *   1. 组件内**禁止**直接 `invoke`；一切经本文件的 `ipc.*`。
 *   2. 集中 try/catch：后端 `Err` 序列化为 `{ code, message }`，此处规范化为 IpcError。
 *   3. 事件订阅统一经 `onIpcEvent`，其返回的 unlisten 必须由调用方在 cleanup 调用（K-8）。
 * 非 Tauri 环境（纯浏览器 dev）自动降级到 src/mocks/browserMock，便于 UI 走查。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AccentColors,
  AccentSetParams,
  CloseNoteWindowParams,
  CreateItemParams,
  Item,
  ItemIdParams,
  ListItemsParams,
  ListRecordsParams,
  Note,
  NoteCreateParams,
  NoteListParams,
  NoteRefParams,
  NoteUpdateParams,
  OpenNoteWindowParams,
  Paginated,
  Reminder,
  ReminderClearParams,
  ReminderSetParams,
  ResolveOpenRecordParams,
  SaveWindowPositionParams,
  SetAutostartParams,
  SetCountdownPresetParams,
  Settings,
  ReferenceSettings,
  ReferenceSettingsPatch,
  StartCountdownParams,
  StartTimerParams,
  StatsSummary,
  StatsSummaryParams,
  SwitchItemParams,
  ThemeSetParams,
  ThemeSettings,
  TimeRecord,
  TimerState,
  Todo,
  TodoCreateParams,
  TodoListParams,
  TodoRefParams,
  TodoToggleParams,
  TodoUpdateParams,
  UndoStopParams,
  UpdateItemParams,
  UpdateRecordParams,
  UpdateSettingsParams,
  IpcApi,
  StopResult,
  WindowRectDip,
  WorkAreaDip,
  PluginListResult,
  MdSyncConfig,
  MdSyncKind,
  MdSyncReport,
  MdSyncView,
  MigrationInfo,
} from '../types/domain';
import { createMockApi } from '../mocks/browserMock';
/* [V0.5.0] 错误类型与规范化搬到 ipcError.ts 腾行数（本文件 295 行 → 余量足够新增 2 条命令）。
   `errorText()` 留在本文件不搬——check-contract.mjs 从这里内联解析 `case '...'`。 */
import { IpcError, normalizeError } from './ipcError';

export { IpcError } from './ipcError';

/** 是否运行在 Tauri（WebView2）运行时 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const mockHandlers = createMockApi();

/** 统一命令调用：Tauri invoke 或浏览器 mock，集中错误规范化 */
async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    if (isTauri()) return await invoke<T>(cmd, args);
    const handler = mockHandlers[cmd];
    if (!handler) throw new IpcError('IO_ERROR', `未实现的命令：${cmd}`);
    return (await handler(args)) as T;
  } catch (err) {
    throw normalizeError(err);
  }
}

/** 订阅后端事件；非 Tauri 环境返回 no-op unlisten。 */
export async function onIpcEvent<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<T>(event, (e) => handler(e.payload as T));
}

/** 业务错误码 -> 面向用户的中文提示 */
export function errorText(err: unknown): string {
  const code = err instanceof IpcError ? err.code : undefined;
  switch (code) {
    case 'DB_ERROR':
      return '数据保存失败，已保留在本地';
    case 'ITEM_NOT_FOUND':
      return '目标不存在，已为你刷新列表';
    case 'ITEM_NAME_EMPTY':
      return '事项名称不能为空';
    case 'ITEM_SYSTEM_PROTECTED':
      return '系统事项不可删除';
    case 'TIMER_ALREADY_RUNNING':
      return '已有进行中的计时，请先结束';
    case 'TIMER_NOT_RUNNING':
      return '当前没有进行中的计时';
    case 'TIMER_NO_UNDO':
      return '撤销窗口已过期';
    case 'INVALID_DURATION':
      return '结束时间早于开始时间';
    case 'IO_ERROR':
      /* [V0.3.0] 此前漏了这一支，会静默落到「操作失败，请稍后重试」——
         由 check:contract 的「错误码文案覆盖」规则抓出。 */
      return '系统调用失败，请重试';
    /* [V0.2.0] */
    case 'NOTE_NOT_FOUND':
      return '便利贴不存在或已删除';
    case 'TODO_NOT_FOUND':
      return '待办不存在或已删除';
    case 'WINDOW_LIMIT_EXCEEDED':
      return '便利贴数量已达上限';
    case 'INVALID_TARGET_SEC':
      return '倒计时时长不合法';
    case 'INVALID_COLOR':
      return '颜色值不合法';
    /* [V0.3.0] 超长与「为空」分开：让表单高亮到正确分支（ADR-018） */
    case 'ITEM_NAME_TOO_LONG':
      return '输入内容过长，请精简后再试';
    /* [V0.4.0] 同步落点配置校验失败：把后端给的具体原因原样透出，
       设置页需要它告诉用户「哪个落点、哪一项」不合法。 */
    case 'MD_SYNC_CONFIG_INVALID':
      return err instanceof Error && err.message ? err.message : '同步设置不合法';
    default:
      return err instanceof Error && err.message ? err.message : '操作失败，请稍后重试';
  }
}

/** IpcApi 实现（前端唯一命令出口，方法名 = 命令名 camelCase） */
export const ipc: IpcApi = {
  dailyStatusGet: (date: string) => call<Record<number, 'pending' | 'done'>>('daily_status_get', { date }),
  dailyStatusSet: (date: string, itemId: number, status: 'pending' | 'done') => call<void>('daily_status_set', { date, itemId, status }),
  /* ---- 事项域 ---- */
  listItems: (params: ListItemsParams) => call<Item[]>('list_items', { includeArchived: params.includeArchived ?? false }),
  createItem: (params: CreateItemParams) => call<Item>('create_item', { name: params.name, color: params.color }),
  updateItem: (params: UpdateItemParams) => call<Item>('update_item', { id: params.id, patch: params.patch }),
  archiveItem: (params: ItemIdParams) => call<Item>('archive_item', { id: params.id }),
  unarchiveItem: (params: ItemIdParams) => call<Item>('unarchive_item', { id: params.id }),
  deleteItem: (params: ItemIdParams) => call<void>('delete_item', { id: params.id }),

  /* ---- 计时域 ---- */
  startTimer: (params: StartTimerParams) =>
    call<TimeRecord>('start_timer', params.itemId != null ? { itemId: params.itemId } : {}),
  pauseTimer: () => call<TimeRecord>('pause_timer'),
  resumeTimer: () => call<TimeRecord>('resume_timer'),
  stopTimer: () => call<StopResult>('stop_timer'),
  discardTimer: () => call<void>('discard_timer'),
  undoStop: (params: UndoStopParams) => call<TimeRecord>('undo_stop', { recordId: params.recordId }),
  getTimerState: () => call<TimerState>('get_timer_state'),
  switchItem: (params: SwitchItemParams) => call<TimerState>('switch_item', { itemId: params.itemId, mode: params.mode }),

  /* ---- 记录域 ---- */
  listRecords: (params: ListRecordsParams) =>
    call<Paginated<TimeRecord>>('list_records', {
      itemId: params.itemId,
      from: params.from,
      to: params.to,
      page: params.page ?? 1,
      limit: params.limit ?? 20,
    }),
  statsSummary: (params: StatsSummaryParams) =>
    call<StatsSummary>('stats_summary', { itemId: params.itemId, from: params.from, to: params.to }),
  updateRecord: (params: UpdateRecordParams) => call<TimeRecord>('update_record', { id: params.id, patch: params.patch }),
  deleteRecord: (params: ItemIdParams) => call<void>('delete_record', { id: params.id }),

  /* ---- 崩溃恢复 ---- */
  resolveOpenRecord: (params: ResolveOpenRecordParams) =>
    call<TimeRecord | null>('resolve_open_record', {
      action: params.action,
      endAt: params.endAt,
      includeGap: params.includeGap ?? false,
    }),

  /* ---- 设置域 ---- */
  getSettings: () => call<Settings>('get_settings'),
  updateSettings: (params: UpdateSettingsParams) => call<Settings>('update_settings', { patch: params.patch }),
  getReferenceSettings: () => call<ReferenceSettings>('get_reference_settings'),
  updateReferenceSettings: (params: { patch: ReferenceSettingsPatch }) => call<ReferenceSettings>('update_reference_settings', { patch: params.patch }),
  setAutostart: (params: SetAutostartParams) => call<boolean>('set_autostart', { enabled: params.enabled }),
  getAutostart: () => call<boolean>('get_autostart'),

  /* ---- 窗口 / 系统域 ---- */
  showWindow: () => call<void>('show_window'),
  mainWorkArea: () => call<WorkAreaDip>('main_work_area'),
  /** 主条（小条）矩形（DIP）：便利贴等浮层「默认落在小条附近」的基准 */
  mainWindowRect: () => call<WindowRectDip>('main_window_rect'),
  hideWindow: () => call<void>('hide_window'),
  toggleWindow: () => call<void>('toggle_window'),
  saveWindowPosition: (params: SaveWindowPositionParams) => call<void>('save_window_position', { x: params.x, y: params.y }),
  quitApp: () => call<void>('quit_app'),

  /* ---- [V0.2.0] 待办域 ---- */
  todoCreate: (params: TodoCreateParams) =>
    call<Todo>('todo_create', { title: params.title, plannedAt: params.plannedAt, remindAt: params.remindAt }),
  todoUpdate: (params: TodoUpdateParams) => call<Todo>('todo_update', { id: params.id, patch: params.patch }),
  todoDelete: (params: TodoRefParams) => call<void>('todo_delete', { id: params.id }),
  todoList: (params: TodoListParams) =>
    call<Todo[]>('todo_list', { includeDone: params.includeDone ?? false, from: params.from, to: params.to }),
  todoToggle: (params: TodoToggleParams) => call<Todo>('todo_toggle', { id: params.id, done: params.done }),
  todoStart: (params: TodoRefParams) => call<TimeRecord>('todo_start', { id: params.id }),

  /* ---- [V0.2.0] 便利贴域 ---- */
  noteCreate: (params: NoteCreateParams) =>
    call<Note>('note_create', {
      itemId: params.itemId,
      content: params.content,
      posX: params.posX,
      posY: params.posY,
      width: params.width,
      height: params.height,
    }),
  noteGet: (params: NoteRefParams) => call<Note>('note_get', { id: params.id }),
  noteList: (params: NoteListParams) => call<Note[]>('note_list', params.itemId != null ? { itemId: params.itemId } : {}),
  noteUpdate: (params: NoteUpdateParams) => call<Note>('note_update', { id: params.id, patch: params.patch }),
  noteDelete: (params: NoteRefParams) => call<void>('note_delete', { id: params.id }),

  /* ---- [V0.2.0] 多窗口域 ---- */
  openNoteWindow: (params: OpenNoteWindowParams) => call<void>('open_note_window', { noteId: params.noteId }),
  closeNoteWindow: (params: CloseNoteWindowParams) => call<void>('close_note_window', { noteId: params.noteId }),
  openTodosWindow: () => call<void>('open_todos_window'),
  openSettingsWindow: () => call<void>('open_settings_window'),
  openTimerWindow: () => call<void>('open_timer_window'),
  /* [V0.3.4] 日记域四条命令实现随模块下架删除（ADR-023）。 */

  /* ---- [V0.2.0] 主题域 ---- */
  themeGet: () => call<ThemeSettings>('theme_get'),
  themeSet: (params: ThemeSetParams) => call<ThemeSettings>('theme_set', { mode: params.mode }),
  accentGet: () => call<AccentColors>('accent_get'),
  accentSet: (params: AccentSetParams) => call<AccentColors>('accent_set', { patch: params.patch }),

  /* ---- [V0.2.0] 计时域 · 倒计时扩展 ---- */
  startCountdown: (params: StartCountdownParams) =>
    call<TimeRecord>('start_countdown', {
      itemId: params.itemId,
      targetSec: params.targetSec,
    }),
  setCountdownPreset: (params: SetCountdownPresetParams) => call<number[]>('set_countdown_preset', { presets: params.presets }),

  /* ---- [V0.2.0] 提醒域 ---- */
  reminderSet: (params: ReminderSetParams) =>
    call<Reminder>('reminder_set', { target: params.target, targetId: params.targetId, remindAt: params.remindAt }),
  reminderClear: (params: ReminderClearParams) => call<void>('reminder_clear', { target: params.target, targetId: params.targetId }),
  reminderPending: () => call<Reminder[]>('reminder_pending'),

  /* ---- [V0.3.2] 插件域 ---- */
  pluginList: () => call<PluginListResult>('plugin_list'),
  pluginOpenDir: () => call<void>('plugin_open_dir'),

  /* ---- [V0.4.0] Markdown 同步（插件 API v2） ---- */
  mdSyncGet: () => call<MdSyncView>('md_sync_get'),
  mdSyncSave: (params: { config: MdSyncConfig }) =>
    call<MdSyncView>('md_sync_save', { config: params.config }),
  mdSyncRun: () => call<MdSyncReport>('md_sync_run'),
  mdSyncOpen: (params: { kind: MdSyncKind }) =>
    call<void>('md_sync_open', { kind: params.kind }),

  /* ---- 迁移可见性 [V0.5.0]（命令 65 → 67，ADR-037） ---- */
  getMigrationInfo: () => call<MigrationInfo>('get_migration_info'),
  openLegacyDir: () => call<void>('open_legacy_dir'),
};
