/**
 * Timing — 手柄动作派发（只主窗）
 * -----------------------------------------------------------------------------
 * 一段固定顺序的判定，五个出口互不重叠，**任何一条都不能静默走错**：
 *
 *   空槽（`null`）      → 什么都不做、不提示   （「这个槽我故意留着空」）
 *   自定义绑定          → 启动应用 / 发快捷键；失败必须提示（见下）
 *   目录里查不到        → 什么都不做、不提示   （配置里留着已删除的动作）
 *   护栏不通过          → 什么都不做 + 1 条提示（唯一会被用户看见的「拒绝」）
 *   没有实现            → 什么都不做、不抛     （目录与实现由单测对齐，这里不兜底报错）
 *
 * 为什么「护栏不过」必须提示、而「空槽 / 未知 id」必须不提示：用户能感知的只有两类
 * 状态 —— 我按了但没有反应（权限不足 / 状态不对，需要知道为什么），以及我本来就没绑
 * （配置的意图就是无）。把后两者也弹提示，等于每次误触都骂用户一句。
 *
 * [0.13] 自定义绑定（`launch:` / `hotkey:`）走**第三条**「用户感知得到失败」的路：
 * 路径被挪走、组合键被 UIPI 拦下、配置被手改成缺修饰键 —— 这些都不是「配置意图为空」，
 * 而是「用户以为配好了、其实没生效」。全部转成一条提示，绝不 console 了事。
 */
import { parseCustomBinding } from '../../../shared/handleCustomBinding';
import type { HandleCustomBinding } from '../../../shared/handleCustomBinding';
import { hotkeyToVirtualKeys, parseHotkey } from '../../../shared/hotkey';
import { findHandleAction } from '../../lib/handleCatalog';
import { errorText, handleCustomApi } from '../api';
import { GUARDS } from './guards';
import type { HandleActionCtx } from './guards';
import { RUNNERS } from './runners';

/** 执行一条自定义绑定。两个分支都不抛（失败变成一条提示）。 */
async function runCustomBinding(binding: HandleCustomBinding, ctx: HandleActionCtx): Promise<void> {
  try {
    if (binding.kind === 'launch') {
      await handleCustomApi.launch(binding.payload);
      return;
    }
    const spec = parseHotkey(binding.payload);
    const vks = spec ? hotkeyToVirtualKeys(spec) : [];
    if (vks.length === 0) {
      /* 配置坏了（手改 / 旧版遗留）：不发给后端 —— 后端只会回「没有要发送的按键」，
         那句话对用户没有任何信息量，他不知道是自己那条绑定不合法。 */
      ctx.notice('这条快捷键已失效，请在设置里重新录制');
      return;
    }
    await handleCustomApi.hotkey(vks);
  } catch (err) {
    ctx.notice(errorText(err));
  }
}

export function dispatchHandleAction(id: string | null, ctx: HandleActionCtx): void {
  if (id == null) return;
  const custom = parseCustomBinding(id);
  if (custom) {
    void runCustomBinding(custom, ctx);
    return;
  }
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
