/**
 * TickBar — 领域 API 门面（视图与容器的唯一数据入口）
 * -----------------------------------------------------------------------------
 * 分层（R1/R3）：
 *   components（纯视图） → services/*Actions（用例） → stores（状态容器） → **本文件** → ipc.ts → invoke
 *
 * 为什么存在这一层：
 *   `ipc.ts` 是传输层（命令名、错误规范化、mock 降级）。让组件与 store 直接 import 它，
 *   等于把「命令名」这一契约细节散布到 50+ 个文件里，改命令时改动点不可枚举。
 *   本文件按**领域**分组暴露能力（item / record / todo / note / settings / timer / window），
 *   上层只认领域动作，不认命令名。机械门禁：`grep "ipc\." src/components src/stores` = 0。
 *
 * 约束：本文件**不得** import stores 或 React（否则与 actions 形成环）。
 */
import { errorText, ipc, isTauri } from './ipc';
import type {
  ActionParams,
  CreateItemParams,
  Item,
  ItemIdParams,
  ListItemsParams,
  ListRecordsParams,
  MdSyncConfig,
  MdSyncKind,
  Note,
  NoteCreateParams,
  NoteListParams,
  NoteUpdateParams,
  Paginated,
  PanelActionOutcome,
  PanelRow,
  QueryParams,
  RecordPatch,
  ReminderClearParams,
  ReminderSetParams,
  ResolveAction,
  Settings,
  StatsSummary,
  StopResult,
  SwitchMode,
  TimeRecord,
  TimerState,
  Todo,
  UpdateItemParams,
  UpdateSettingsParams,
} from '../types/domain';

/* ---- 事项 ---- */
export const itemApi = {
  list: (params?: ListItemsParams): Promise<Item[]> => ipc.listItems(params ?? { includeArchived: false }),
  create: (params: CreateItemParams): Promise<Item> => ipc.createItem(params),
  update: (params: UpdateItemParams): Promise<Item> => ipc.updateItem(params),
  remove: (params: ItemIdParams): Promise<void> => ipc.deleteItem(params),
  archive: (params: ItemIdParams): Promise<Item> => ipc.archiveItem(params),
  unarchive: (params: ItemIdParams): Promise<Item> => ipc.unarchiveItem(params),
};

/* ---- 记录 ---- */
export const recordApi = {
  list: (params: ListRecordsParams): Promise<Paginated<TimeRecord>> => ipc.listRecords(params),
  /** 汇总（唯一统计口径，见 PRD §6）：移动端记录页的「总计 / 按事项分布」只用它 */
  summary: (from: number, to: number): Promise<StatsSummary> => ipc.statsSummary({ from, to }),
  update: (id: number, patch: RecordPatch): Promise<TimeRecord> => ipc.updateRecord({ id, patch }),
  remove: (params: ItemIdParams): Promise<void> => ipc.deleteRecord(params),
};

/* ---- 待办 ---- */
export const todoApi = {
  list: (params?: { includeDone?: boolean }): Promise<Todo[]> => ipc.todoList(params ?? { includeDone: true }),
  create: (title: string, plannedAt?: number | null, remindAt?: number | null): Promise<Todo> =>
    ipc.todoCreate({ title, plannedAt, remindAt }),
  update: (id: number, patch: Partial<Todo>): Promise<Todo> => ipc.todoUpdate({ id, patch }),
  toggle: (id: number, done: boolean): Promise<Todo> => ipc.todoToggle({ id, done }),
  /** [V0.3.12] 待办 → 计时（开始即移出待办区，ADR-030） */
  start: (id: number): Promise<TimeRecord> => ipc.todoStart({ id }),
  remove: (id: number): Promise<void> => ipc.todoDelete({ id }),
};

/* ---- 便利贴 ---- */
export const noteApi = {
  get: (id: number): Promise<Note> => ipc.noteGet({ id }),
  list: (params: NoteListParams): Promise<Note[]> => ipc.noteList(params),
  create: (params: NoteCreateParams): Promise<Note> => ipc.noteCreate(params),
  update: (params: NoteUpdateParams): Promise<Note> => ipc.noteUpdate(params),
  remove: (id: number): Promise<void> => ipc.noteDelete({ id }),
};

/* ---- 设置 ---- */
export const settingsApi = {
  get: (): Promise<Settings> => ipc.getSettings(),
  update: (patch: UpdateSettingsParams['patch']): Promise<Settings> => ipc.updateSettings({ patch }),
  getReference: () => ipc.getReferenceSettings(),
  updateReference: (patch: Record<string, unknown>) =>
    ipc.updateReferenceSettings({ patch } as never),
};

/* ---- 计时 ---- */
export const timerApi = {
  state: (): Promise<TimerState> => ipc.getTimerState(),
  start: (itemId?: number | null) => ipc.startTimer(itemId == null ? {} : { itemId }),
  pause: () => ipc.pauseTimer(),
  resume: () => ipc.resumeTimer(),
  stop: (): Promise<StopResult> => ipc.stopTimer(),
  discard: () => ipc.discardTimer(),
  /** 撤销结束（3s 撤销条） */
  undo: (recordId: number) => ipc.undoStop({ recordId }),
  /** 换事项：end_and_start = 分段，just_switch = 只改归属（时长连续） */
  switchItem: (itemId: number, mode: SwitchMode): Promise<TimerState> => ipc.switchItem({ itemId, mode }),
  /** 定长倒计时；到点由后端恒结束并保存（ADR-023） */
  startCountdown: (itemId: number | null, targetSec: number) =>
    ipc.startCountdown({ itemId: itemId ?? undefined, targetSec }),
  setCountdownPresets: (presets: number[]) => ipc.setCountdownPreset({ presets }),
  /** 崩溃恢复三选一；`includeGap` = 把退出期间并入累计（默认 false） */
  resolveOpenRecord: (action: ResolveAction, includeGap = false) =>
    ipc.resolveOpenRecord({ action, includeGap }),
};

/* ---- 提醒 ---- */
export const reminderApi = {
  pending: () => ipc.reminderPending(),
  set: (params: ReminderSetParams) => ipc.reminderSet(params),
  clear: (params: ReminderClearParams) => ipc.reminderClear(params),
};

/* ---- [V0.3.4] 日记域 diaryApi 已随日记模块整体下架删除（ADR-023） ---- */

/* ---- 窗口 / 系统 ---- */
export const windowApi = {
  openTimerWindow: (): Promise<void> => ipc.openTimerWindow(),
  openTodosWindow: (): Promise<void> => ipc.openTodosWindow(),
  openSettingsWindow: (): Promise<void> => ipc.openSettingsWindow(),
  hide: (): Promise<void> => ipc.hideWindow(),
  show: (): Promise<void> => ipc.showWindow(),
  toggle: (): Promise<void> => ipc.toggleWindow(),
  quit: (): Promise<void> => ipc.quitApp(),
};

/* ---- [V0.3.2] 插件（声明式：只读启动头，不执行插件代码） ---- */
export const pluginApi = {
  list: () => ipc.pluginList(),
  openDir: (): Promise<void> => ipc.pluginOpenDir(),
  /* ---- [v3] 面板 ---- */
  openPanel: (pluginId: string, panelId: string): Promise<void> =>
    ipc.pluginPanelOpen({ pluginId, panelId }),
  panelData: (source: string, params?: QueryParams): Promise<PanelRow[]> =>
    ipc.pluginPanelData({ source, params }),
  runAction: (action: string, params?: ActionParams): Promise<PanelActionOutcome> =>
    ipc.pluginActionRun({ action, params }),
};

/* ---- [V0.4.0] Markdown 同步（插件 API v2；执行在 Rust，前端只配置/看状态） ---- */
export const mdSyncApi = {
  get: () => ipc.mdSyncGet(),
  save: (config: MdSyncConfig) => ipc.mdSyncSave({ config }),
  run: () => ipc.mdSyncRun(),
  open: (kind: MdSyncKind): Promise<void> => ipc.mdSyncOpen({ kind }),
};

export { isTauri };
/* 错误文案也走门面：视图层要的是「给用户看的一句话」，不是传输层对象。
   从本文件再导出，组件就不必为了一个文案函数直接 import services/ipc。 */
export { errorText };
