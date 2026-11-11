/**
 * Timing — 手柄动作的实现（只主窗）
 * -----------------------------------------------------------------------------
 * 这张表是「动作 id → 一次调用」的**薄转发层**，不含任何编排：
 *   - 编排逻辑一律还在原处（`useTimerActions` / `*Actions` / `mdSyncApi`），
 *     这里重写一遍就会立刻出现两份不一致的业务时序；
 *   - 不出现 `ipc.` 字面量：命令名只该活在 `services/` 的既有出口里，
 *     这样 T03 改落点时（`settings.open`）只动 service，不碰注册表；
 *   - 不 import `src/stores/**`：UI 状态一律由 `ctx.ui` 传进来，
 *     否则「组件不碰 store」这条规矩会从注册表这个后门绕回来。
 *
 * 与目录的关系：`RUNNERS` 的 key 集合必须 ≡ `HANDLE_ACTIONS` 的 id 集合（**双向**，
 * 由 `runners.test.ts` 的 `a02_registry_and_runners_cover_each_other` 钉死）。
 * 少一条 = 用户绑了却点了没反应；多一条 = 目录里查不到的僵尸实现。
 */
import { errorText, mdSyncApi } from '../api';
import { openOrCreateNoteForItem } from '../noteActions';
import { openSettingsInPatina, settingsActions } from '../settingsActions';
import { openDigestPanel, openTodayPanel } from '../todayActions';
import { openTodosWindow } from '../todosActions';
import type { HandleActionRunner } from './guards';

export const RUNNERS: Record<string, HandleActionRunner> = {
  /* 三处直接引用（不是箭头包装）：`today.panel` / `today.digest` 要能被断言成
     「与 `openTodayPanel` 是同一个函数」——包一层就再也证不了没有第二份实现。 */
  'patina.open': () => settingsActions.openPatina(),
  'today.panel': openTodayPanel,
  'today.digest': openDigestPanel,
  'note.current': async (ctx) => {
    await openOrCreateNoteForItem(ctx.itemId);
  },
  'note.list': (ctx) => {
    ctx.ui.openNotesList(ctx.anchor());
  },
  'todos.open': openTodosWindow,
  /* 依赖 T03：后端 `PatinaOpenTarget` 认 `settings` 之前，这条载荷会被宿主拒收
     （Rust 侧 `deny_unknown_fields`），表现为一条「没能打开设置」的提示。
     本轮先落前端契约，命令名与条数不变。 */
  'settings.open': openSettingsInPatina,
  'timer.start': (ctx) => ctx.timer.start(ctx.itemId ?? undefined),
  'timer.pause': (ctx) => ctx.timer.togglePause(),
  'timer.stop': async (ctx) => {
    /* `stop()` 的返回值是给「结束后补名字」那一层用的，手柄槽位不消费它 */
    await ctx.timer.stop();
  },
  'md.sync': async (ctx) => {
    /* 同步在 Rust 里跑，失败原因（目录不可写 / 云端鉴权）只有它知道，
       吞掉就等于「点了没反应」，所以原样转成一条提示 */
    try {
      await mdSyncApi.run();
    } catch (err) {
      ctx.notice(errorText(err));
    }
  },
  'menu.countdown': (ctx) => {
    ctx.ui.openCountdownMenu({ pos: ctx.anchor(), itemId: ctx.itemId });
  },
  'menu.moyu': (ctx) => {
    ctx.ui.openMoyuMenu({ pos: ctx.anchor(), itemId: ctx.itemId });
  },
};
