/**
 * Timing 领域类型 V0.2.0 增量（资源分包）
 * -----------------------------------------------------------------------------
 * Document ID : domain-v020.ts
 * Status      : Draft for V0.2.0-1 review
 * Owner       : 高见远（首席架构师）
 * Upstream    : docs/phase1/ARCHITECTURE-V0.2.0.md §5（IPC 契约增量）
 *               docs/phase2/schema-V0.2.0.sql
 *
 * 说明
 *  - 本文件承载 V0.2.0 新增的「按资源分包」类型（Note / Todo / Theme / Reminder），
 *    由 `./domain.ts` 末尾 `export * from './domain-v020'` 统一 re-export；
 *    消费方仍可只 `import ... from './types/domain'`（保持既有风格）。
 *  - 拆分的理由：`domain.ts` 已达 ~280 有效代码行，逼近「单文件 ≤ 300 行」硬上限
 *    （docs/phase1/ARCHITECTURE-v1.md §3.4 / code-organization.md §4）。
 *  - 字段名一律 camelCase，与 Rust DTO（#[serde(rename_all = "camelCase")]）一一对应。
 * -----------------------------------------------------------------------------
 */

import type { EpochMs, Seconds } from './domain/constants';

/* ===========================================================================
 * 便利贴 Note（一窗一行；窗口由 note-{id} 承载）
 * ========================================================================= */

/** 便利贴 */
export interface Note {
  /** 主键（= 窗口 label note-{id} 的尾号） */
  id: number;
  /** 挂靠事项 id；null = 独立便签 */
  itemId: number | null;
  /** 正文（纯文本，保留换行；长度 ≤ NOTE_CONTENT_MAX_LEN） */
  content: string;
  /** 逻辑像素 x（非物理像素，K-15） */
  posX: number;
  /** 逻辑像素 y */
  posY: number;
  /** 逻辑像素宽（≥ NOTE_MIN_W） */
  width: number;
  /** 逻辑像素高（≥ NOTE_MIN_H） */
  height: number;
  /** 窗口当前是否打开（启动据此恢复，K-14） */
  isOpen: boolean;
  /**
   * 是否置顶（窗口 always-on-top；AC-64）。
   *
   * [V0.3.0] 由数据库列 `notes.is_pinned` 承载（默认 true），不再随窗口硬编码。
   * 语义是**窗口层级**，与「列表排序置顶」无关（那是 `items.isPinned`）。
   */
  isPinned: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** note_update 的部分更新字段 */
export interface NotePatch {
  itemId?: number | null;
  content?: string;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  /** 置顶开关（缺省 = 不改；后端落库后同步窗口层级） */
  isPinned?: boolean;
}

/** note_create 入参（只建数据行，不建窗口；窗口由 open_note_window 负责） */
export interface NoteCreateParams {
  itemId?: number;
  content: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
}

/** 便利贴定位入参（note_get / note_delete） */
export interface NoteRefParams {
  id: number;
}

/** note_list 入参 */
export interface NoteListParams {
  /** 按事项过滤；省略 = 全部 */
  itemId?: number;
}

/** note_update 入参 */
export interface NoteUpdateParams {
  id: number;
  patch: NotePatch;
}

/** open_note_window / close_note_window 入参 */
export interface OpenNoteWindowParams {
  noteId: number;
}
export interface CloseNoteWindowParams {
  noteId: number;
}

/* ===========================================================================
 * 待办 Todo（独立，不挂事项）
 * ========================================================================= */

/** 待办事项 */
export interface Todo {
  id: number;
  /** 标题（长度 1-200） */
  title: string;
  /** [V0.11.3] 绑定的具体事项；null = 还没绑（开始计时时按标题匹配并回填） */
  itemId: number | null;
  /** 计划执行时刻；null = 未排期 */
  plannedAt: EpochMs | null;
  /** 提醒时刻；null = 无提醒 */
  remindAt: EpochMs | null;
  /** 该提醒已触发时刻；null = 未触发（去重标记，K-19） */
  remindedAt: EpochMs | null;
  /** 完成时刻；null = 未完成 */
  doneAt: EpochMs | null;
  /** 手动排序（升序） */
  sortOrder: number;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** todo_update 的部分更新字段 */
export interface TodoPatch {
  title?: string;
  /** [V0.11.3] 改绑 / 解绑事项：省略 = 不动，null = 解绑 */
  itemId?: number | null;
  plannedAt?: EpochMs | null;
  remindAt?: EpochMs | null;
  sortOrder?: number;
  /** [V0.3.12] 「当前事项结束后自动开始」（ADR-030） */
  autoStart?: boolean;
}

/** todo_create 入参 */
export interface TodoCreateParams {
  title: string;
  /** [V0.11.3] 绑定的事项；省略则按标题自动匹配 */
  itemId?: number | null;
  plannedAt?: EpochMs | null;
  remindAt?: EpochMs | null;
}

/** 待办定位入参（todo_delete） */
export interface TodoRefParams {
  id: number;
}

/** todo_update 入参 */
export interface TodoUpdateParams {
  id: number;
  patch: TodoPatch;
}

/** todo_list 入参 */
export interface TodoListParams {
  /** 是否含已完成；默认 false */
  includeDone?: boolean;
  /** 起始（含），作用于 plannedAt */
  from?: EpochMs;
  /** 结束（不含），作用于 plannedAt */
  to?: EpochMs;
}

/** todo_toggle 入参（显式传 done，避免盲翻转竞态） */
export interface TodoToggleParams {
  id: number;
  done: boolean;
}

/* ===========================================================================
 * 主题 Theme（双主题 + 四色可配）
 * ========================================================================= */

/** 主题模式。system = 跟随系统 prefers-color-scheme（ADR-012） */
export type ThemeMode = 'dark' | 'light' | 'system';

/**
 * 四色可配（均为 hex 字符串，用户数据，非设计 token）。
 * running=计时中；warn=提醒；done=完成；bar=小条底色。
 * bar = null 表示「跟随主题令牌」（默认），用户显式设置后才落 hex。
 */
export interface AccentColors {
  running: string;
  warn: string;
  done: string;
  bar: string | null;
}

/** theme_get / theme_set 返回 */
export interface ThemeSettings {
  mode: ThemeMode;
}

/** theme_set 入参 */
export interface ThemeSetParams {
  mode: ThemeMode;
}

/** accent_set 入参（部分更新；非法 hex → INVALID_COLOR） */
export interface AccentSetParams {
  patch: Partial<AccentColors>;
}

/* ===========================================================================
 * 提醒 Reminder（事项 / 待办共用）
 * ========================================================================= */

/** 提醒目标类型 */
export type ReminderTarget = 'item' | 'todo';

/** 提醒视图对象（reminder_pending 列表项 / reminder_set 返回） */
export interface Reminder {
  /** 目标类型 */
  target: ReminderTarget;
  /** 目标 id（item 或 todo） */
  targetId: number;
  /** 目标标题（事项名或待办标题，供展示） */
  title: string;
  /** 提醒时刻（epoch 毫秒） */
  remindAt: EpochMs;
}

/** reminder_set 入参（重设会清 remindedAt，使提醒复活，K-19） */
export interface ReminderSetParams {
  target: ReminderTarget;
  targetId: number;
  remindAt: EpochMs;
}

/** reminder_clear 入参 */
export interface ReminderClearParams {
  target: ReminderTarget;
  targetId: number;
}

/** reminder-fired 事件载荷（= Reminder） */
export type ReminderFiredPayload = Reminder;

/**
 * todo-nudge 事件载荷（[V0.3.12] / ADR-030）。
 * stage = 1 轻提醒（开始前 15 分钟，问要不要改时间）；
 * stage = 2 自动开始询问（开始前 5 分钟，问当前结束后是否自动开始）。
 */
export interface TodoNudge {
  todoId: number;
  title: string;
  /** 待办的开始时刻（= todos.remindAt） */
  remindAt: EpochMs;
  stage: 1 | 2;
}

/** todo-nudge 事件载荷别名 */
export type TodoNudgePayload = TodoNudge;

/** 倒计时剩余秒数（保留类型别名，与 TimerState.remainingSec 同义） */
export type RemainingSec = Seconds;
