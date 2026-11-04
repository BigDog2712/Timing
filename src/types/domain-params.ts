/**
 * TickBar 领域类型 —— 命令入参 / Patch DTO（自 ./domain.ts 外移）
 * -----------------------------------------------------------------------------
 * 归组：全部命令入参（list_items … save_window_position）+ 两个部分更新 patch
 *      （ItemPatch / RecordPatch）。仅承载「入参形态」，不含返回实体。
 * 对外面不变：./domain.ts 末尾 `export * from './domain-params'` 统一 re-export，
 *      调用方仍 `from './types/domain'` 引入即可，无需改动。
 * -----------------------------------------------------------------------------
 */
import type { EpochMs, Seconds } from './domain/constants';
import type { ResolveAction, Settings, SwitchMode } from './domain/models';

export interface ListItemsParams {
  /** 是否包含已归档事项；默认 false */
  includeArchived?: boolean;
}

export interface CreateItemParams {
  name: string;
  /** 标签色 hex；省略 = 主题默认 */
  color?: string;
}

/** update_item 的部分更新字段 */
export interface ItemPatch {
  name?: string;
  color?: string;
  sortOrder?: number;
  /** [V0.2.0] 提醒时刻；null = 清除提醒 */
  remindAt?: EpochMs | null;
  /** [V0.2.0] 固定任务开关 */
  isPinned?: boolean;
}

export interface UpdateItemParams {
  id: number;
  patch: ItemPatch;
}

export interface ItemIdParams {
  id: number;
}

export interface StartTimerParams {
  /** 归属事项 id；省略 = 1（未归类） */
  itemId?: number;
}

/** [V0.2.0] start_countdown 入参 */
export interface StartCountdownParams {
  /** 归属事项 id；省略 = 1（未归类） */
  itemId?: number;
  /** 倒计时目标秒数（>0 且 ≤ MAX_COUNTDOWN_SEC）；非法 → INVALID_TARGET_SEC */
  targetSec: Seconds;
}

/** [V0.2.0] set_countdown_preset 入参 */
export interface SetCountdownPresetParams {
  /** 预设秒数列表（去重 + 升序 + 每项 >0；上限 8 个） */
  presets: number[];
}

export interface UndoStopParams {
  /** 待撤销的已保存记录 id */
  recordId: number;
}

export interface SwitchItemParams {
  itemId: number;
  mode: SwitchMode;
}

export interface ListRecordsParams {
  itemId?: number;
  /** 起始（含），作用于 startedAt */
  from?: EpochMs;
  /** 结束（不含），作用于 startedAt */
  to?: EpochMs;
  /** 页码，从 1 起；默认 1 */
  page?: number;
  /** 每页条数；默认 20，上限 100 */
  limit?: number;
}

export interface StatsSummaryParams {
  itemId?: number;
  from?: EpochMs;
  to?: EpochMs;
}

/** update_record 的部分更新字段 */
export interface RecordPatch {
  itemId?: number;
  startedAt?: EpochMs;
  endedAt?: EpochMs;
  note?: string;
}

export interface UpdateRecordParams {
  id: number;
  patch: RecordPatch;
}

export interface ResolveOpenRecordParams {
  action: ResolveAction;
  /** 仅 action='close' 时有意义；省略 = now */
  endAt?: EpochMs;
  /**
   * [V0.4.2] 把「退出期间」（最后一次落盘 → 结束/现在）并入累计。
   * 省略 = false（R-2：应用关着就停表）；暂停中崩溃时后端忽略此开关。
   */
  includeGap?: boolean;
}

export interface UpdateSettingsParams {
  patch: Partial<Settings>;
}

export interface SetAutostartParams {
  enabled: boolean;
}

export interface SaveWindowPositionParams {
  /** 逻辑像素 x */
  x: number;
  /** 逻辑像素 y */
  y: number;
}
