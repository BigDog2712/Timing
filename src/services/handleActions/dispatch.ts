/**
 * Timing — 手柄动作派发（只主窗）
 * -----------------------------------------------------------------------------
 * 一段固定顺序的判定，四个出口互不重叠，**任何一条都不能静默走错**：
 *
 *   空槽（`null`）      → 什么都不做、不提示   （「这个槽我故意留着空」）
 *   目录里查不到        → 什么都不做、不提示   （配置里留着已删除的动作）
 *   护栏不通过          → 什么都不做 + 1 条提示（唯一会被用户看见的「拒绝」）
 *   没有实现            → 什么都不做、不抛     （目录与实现由单测对齐，这里不兜底报错）
 *
 * 为什么「护栏不过」必须提示、而「空槽 / 未知 id」必须不提示：用户能感知的只有两类
 * 状态 —— 我按了但没有反应（权限不足 / 状态不对，需要知道为什么），以及我本来就没绑
 * （配置的意图就是无）。把后两者也弹提示，等于每次误触都骂用户一句。
 */
import { findHandleAction } from '../../lib/handleCatalog';
import { GUARDS } from './guards';
import type { HandleActionCtx } from './guards';
import { RUNNERS } from './runners';

export function dispatchHandleAction(id: string | null, ctx: HandleActionCtx): void {
  if (id == null) return;
  const action = findHandleAction(id);
  if (!action) return;
  const guard = GUARDS[id];
  if (guard && !guard({ status: ctx.status, itemId: ctx.itemId })) {
    /* 兜底文案也要带动作名：「现在不可用」单独一句会让用户不知道是哪一格出的问题 */
    ctx.notice(action.blockedHint ?? `${action.label} 现在不可用`);
    return;
  }
  void RUNNERS[id]?.(ctx);
}
