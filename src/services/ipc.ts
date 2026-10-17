/**
 * TickBar — IPC 唯一出口（K-11）
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
  ErrorCode,
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
  RegisterShortcutParams,
  SaveWindowPositionParams,
  SetAlwaysOnTopParams,
  SetAutostartParams,
  SetCountdownPresetParams,
  Settings,
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
} from '../types/domain';
import { createMockApi } from '../mocks/browserMock';

/** 规范化后的 IPC 失败对象（业务错误码 + 人类可读信息） */
export class IpcError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

/** 是否运行在 Tauri（WebView2）运行时 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const mockHandlers = createMockApi();

/** 把后端 rejected value 规范化成 IpcError */
function normalizeError(raw: unknown): IpcError {
  if (raw instanceof IpcError) return raw;
  if (raw && typeof raw === 'object') {
    const anyRaw = raw as { code?: unknown; message?: unknown };
    if (typeof anyRaw.code === 'string') {
      return new IpcError(anyRaw.code as ErrorCode, typeof anyRaw.message === 'string' ? anyRaw.message : '操作失败');
    }
    if (typeof anyRaw.message === 'string') return new IpcError('IO_ERROR', anyRaw.message);
  }
  if (typeof raw === 'string' && raw.length > 0) return new IpcError('IO_ERROR', raw);
  return new IpcError('IO_ERROR', '操作失败，请稍后重试');
}

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
    case 'ITEM_NAME_DUPLICATE':
      return '已存在同名事项';
    case 'ITEM_SYSTEM_PROTECTED':
      return '系统事项不可删除';
    case 'TIMER_ALREADY_RUNNING':
      return '已有进行中的计时，请先结束';
    case 'TIMER_NOT_RUNNING':
      return '当前没有进行中的计时';
    case 'TIMER_NO_UNDO':
      return '撤销窗口已过期';
    case 'SHORTCUT_REGISTER_FAILED':
      return '该组合键已被占用';
    case 'INVALID_DURATION':
      return '结束时间早于开始时间';
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
    default:
      return err instanceof Error && err.message ? err.message : '操作失败，请稍后重试';
  }
}

/** IpcApi 实现（前端唯一命令出口，方法名 = 命令名 camelCase） */
export const ipc: IpcApi = {
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
  stopTimer: () => call<TimeRecord>('stop_timer'),
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
    call<TimeRecord | null>('resolve_open_record', { action: params.action, endAt: params.endAt }),

  /* ---- 设置域 ---- */
  getSettings: () => call<Settings>('get_settings'),
  updateSettings: (params: UpdateSettingsParams) => call<Settings>('update_settings', { patch: params.patch }),
  setAutostart: (params: SetAutostartParams) => call<boolean>('set_autostart', { enabled: params.enabled }),
  getAutostart: () => call<boolean>('get_autostart'),

  /* ---- 快捷键域 [P1] ---- */
  registerShortcut: (params: RegisterShortcutParams) =>
    call<boolean>('register_shortcut', { action: params.action, accelerator: params.accelerator }),

  /* ---- 窗口 / 系统域 ---- */
  showWindow: () => call<void>('show_window'),
  hideWindow: () => call<void>('hide_window'),
  toggleWindow: () => call<void>('toggle_window'),
  setAlwaysOnTop: (params: SetAlwaysOnTopParams) => call<void>('set_always_on_top', { enabled: params.enabled }),
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
};
