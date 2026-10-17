/**
 * TickBar — 前端 UI 层类型（与领域类型 domain.ts 分离）
 * -----------------------------------------------------------------------------
 * `VisualState` = 视觉状态，包含三态状态机（idle | running | paused）**外加**一次
 * 900ms 的结束瞬时确认（ended）。注意：ended **不是**计时状态机的第四个状态
 * （IPC-CONTRACT-v2 已移除 draft，状态机仅 idle | running | paused）。
 */
import type { TimerStatus } from './domain';

export type VisualState = 'idle' | 'running' | 'paused' | 'ended';

/** 依计时状态 + 结束瞬时标记推导视觉状态 */
export function toVisualState(status: TimerStatus, ended: boolean): VisualState {
  if (ended) return 'ended';
  if (status === 'running') return 'running';
  if (status === 'paused') return 'paused';
  return 'idle';
}
