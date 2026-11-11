/**
 * Timing — 分析窗意图的**执行端**（P0-04 / P0-05，FUSION-ARCH-v1 §6.4）
 * -----------------------------------------------------------------------------
 * 分析窗（label = `patina`）没有任何写命令，它只 `emitTo("main", …)` 喊一句「我想干什么」。
 * 本模块挂在**药丸**（label = `main`）上，收到之后用**宿主的既有 typed IPC** 去执行并落库。
 * Rust 侧对这条通道完全不知情：没有新命令、没有新事件常量、契约十个数不变。
 *
 * ## 窗口 label 反着写，别记错
 * 药丸的 label 是 `main`；分析窗的 label 是 `patina`（Rust insight 侧 `MAIN_WINDOW_LABEL`
 * 指的是分析窗）。本文件运行在药丸里，所以「对面」是分析窗。
 *
 * ## 为什么错误只在这里提示
 * 分析窗只表达意图、不承诺结果（§6.4）。建事项/开始计时被拒时用既有的
 * `setNotice({tone:'danger'})` 在**药丸**上出现；分析窗靠随后的 `timer:state-changed`
 * 广播自然收敛，拿不到也不需要错误文案（§6.5「跨窗只传意图，不传错误」）。
 */
import { useCallback } from 'react';

import { useTauriEvent } from '../hooks/useTauriEvent';
import { useTimerActions } from '../hooks/useTimerActions';
import { errorText, ipc } from './ipc';
import { itemApi } from './api';
import { highlightPill } from './highlightActions';
import { openSettings } from './settingsActions';
import { openTodosWindow } from './todosActions';
import { useItemStore } from '../stores/itemStore';
import { useUiStore } from '../stores/uiStore';
import { openNoteWindowFor } from './noteActions';

/**
 * 与 `src/platform/runtime/insightEvents.ts` 的 `HOST_INTENT` **逐字一致**。
 * L9 禁止跨窗 import，所以两侧各写一份；改一处必须改两处，否则意图「静默不达」。
 *
 * ⚠️ **不进** 宿主 `IPC_EVENTS`（`src/types/domain/ipc.ts:83`）：Rust 从不 emit 它，
 * 写进去会被 `scripts/check-contract.mjs:282-287` 判成死常量。契约事件数保持 11。
 */
const HOST_INTENT = 'patina:host-intent';

/** 与 `hostIntentGateway.ts` 的 `HostIntent` 字段名逐字一致（两侧各声明一份，L9）。 */
type HostIntent =
  | { action: 'start_timer_for_activity'; itemName: string }
  /** P1-01 补记：字段名与 `hostIntentGateway.ts` 逐字一致（L9 禁止跨窗 import，两侧各写一份） */
  | { action: 'backfill_record'; itemName: string; startedAt: number; endedAt: number }
  | { action: 'toggle_timer' }
  | { action: 'open_host_settings' }
  | { action: 'show_pill' }
  /** 打开独立待办窗（今日概览待办卡点行体）。字段名与 `hostIntentGateway.ts` 逐字一致 */
  | { action: 'open_todos' }
  /* [P3 · 0.12.1] 与 `hostIntentGateway.ts` 逐字一致（L9：两侧各写一份，靠 source test 钉相等） */
  | { action: 'open_items_menu' }
  | { action: 'open_common_items' }
  | { action: 'open_moyu_menu' }
  | { action: 'open_note'; noteId: number };

/** 菜单在药丸内容区里的固定锚点（见 gateway 侧「锚点口径」注释）。 */
const PILL_ANCHOR = { x: 12, y: 12 } as const;

/** 唤起药丸（不闪高亮）：菜单要开在看得见的窗上，否则用户以为「点了没反应」。 */
function revealPill(): void {
  useUiStore.getState().setCollapsed(false);
  void ipc.showWindow().catch((error) => {
    console.warn('reveal pill failed', error);
  });
}

/** 按名精确匹配（trim 后全等，不分大小写）：不做模糊匹配，「Code」不该命中「VS Code」。 */
function findItemByName(items: { id: number; name: string }[], name: string) {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  return items.find((item) => item.name.trim().toLowerCase() === wanted);
}

/**
 * 按名取事项，没有就按该名字新建（并在新建后刷新列表）。名字为空 → `null`。
 *
 * 两条意图（从现在开始 / 补记）共用这一步：事项名的判定只许有一处，
 * 否则「补记建了一条、开始计时又建一条」的重名会重新出现。
 */
async function ensureItemByName(rawName: string): Promise<{ id: number } | null> {
  const name = rawName.trim();
  if (!name) return null;
  const existing = findItemByName(useItemStore.getState().items, name);
  if (existing) return existing;
  const created = await itemApi.create({ name });
  /* 新建后刷新事项列表：否则药丸的事项菜单/常用事项框里看不到它，
     下一次同一条意图又会被判成「没有同名事项」再建一条重名。 */
  await useItemStore.getState().reload();
  return created;
}

/**
 * 挂一次意图监听。**只在药丸根组件里调用一次**（`src/App.tsx` 的 `MainWindow`）：
 * 挂两处会让同一条意图被执行两次（`toggle_timer` 连切两下 = 看起来没反应）。
 */
export function useHostIntentBridge(): void {
  const { startOrSwitch, togglePause } = useTimerActions();

  const handleStartForActivity = useCallback(async (itemName: string) => {
    try {
      /* ① 同名事项精确匹配；没有就按应用名新建（判据②：事项名 = 应用名） */
      const target = await ensureItemByName(itemName);
      if (!target) return;
      /* ② 计时从「现在」开始、不回填历史区间；已在计时则先暂停冻结累计再分段切过去
         （`startOrSwitch` 就是为这条路径写的，见 useTimerActions.ts 的注释）。 */
      await startOrSwitch(target.id);
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    }
  }, [startOrSwitch]);

  /**
   * 补记（P1-01）：把一段**过去**的活动补成一条 `saved` 记录。
   *
   * **绝不碰计时状态**：不调 `startOrSwitch`、不调 `togglePause`。用户点「补记」是
   * 「把刚才那一段记下来」，不是「从现在开始计」——顺手起一个新计时正是 §3.4 要防的事。
   * 成败由宿主的 `timer:state-changed` 广播自然收敛（§6.5）：分析窗只发意图、不承诺结果，
   * 真正失败（事项建不出来 / 时长非法）用药丸上的 `setNotice` 呈现。
   */
  const handleBackfill = useCallback(async (itemName: string, startedAt: number, endedAt: number) => {
    try {
      const target = await ensureItemByName(itemName);
      if (!target) return;
      await ipc.createRecord({ itemId: target.id, startedAt, endedAt, note: null });
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    }
  }, []);

  const handleIntent = useCallback((intent: HostIntent) => {
    switch (intent.action) {
      case 'start_timer_for_activity':
        void handleStartForActivity(intent.itemName);
        return;
      case 'backfill_record':
        void handleBackfill(intent.itemName, intent.startedAt, intent.endedAt);
        return;
      case 'toggle_timer':
        /* 方向由药丸读自身状态决定（分析窗不猜），与用户点大按钮完全同一条路径 */
        void togglePause();
        return;
      /* [0.12.1 T04b] 语义与落点终于对齐：设置只有一个家（分析窗 settings 视图）。
         以前这里要把药丸展开 + 打开内联设置面板；面板下线后，这条意图直接走
         `openSettings()`——和托盘、菜单、手柄 'settings.open' 完全同一条路。 */
      case 'open_host_settings':
        void openSettings().catch((error) => {
          console.warn('open settings failed', error);
        });
        return;
      case 'show_pill':
        /* 唤起并高亮：复用托盘双击那条处理函数（取高亮色 → 写到根节点 → 闪三下），
           这样「高亮颜色」这个设置项只在一处读，不会出现两套取色逻辑。 */
        useUiStore.getState().setCollapsed(false);
        void ipc.showWindow().catch((error) => {
          console.warn('show pill failed', error);
        });
        void highlightPill();
        return;
      case 'open_items_menu':
        /* [P3] 锚点固定药丸左上角：分析窗拿不到药丸屏幕坐标，换算要读窗口几何还得处理 DPI，
           不如给一个确定的落点（见 gateway 侧注释）。先唤起药丸再开菜单，否则菜单开在看不见的窗上。 */
        revealPill();
        useUiStore.getState().openItemMenu({ pos: PILL_ANCHOR, itemId: null });
        return;
      case 'open_common_items':
        revealPill();
        useUiStore.getState().openCommonItems(PILL_ANCHOR);
        return;
      case 'open_moyu_menu':
        revealPill();
        useUiStore.getState().openMoyuMenu({ pos: PILL_ANCHOR });
        return;
      case 'open_note':
        /* 与便利贴清单、事项菜单同一条路（services/noteActions）：单例窗，已开则前置。
           noteId 不存在时 openNoteWindowFor 自己抛，这里只 warn 不弹错 —— 分析窗比药丸旧时
           可能出现「那张便利贴已经删了」。 */
        void openNoteWindowFor(intent.noteId).catch((error) => {
          console.warn('open note window failed', error);
        });
        return;
      case 'open_todos':
        /* 与药丸菜单/胶囊同一条路（services/todosActions.ts）：单例窗，已开则前置 */
        void openTodosWindow().catch((error) => {
          console.warn('open todos window failed', error);
        });
        return;
      default:
        /* 分析窗版本比药丸新时可能发来不认识的动作：忽略，不抛、不提示 */
        return;
    }
  }, [handleStartForActivity, handleBackfill, togglePause]);

  useTauriEvent<HostIntent>(HOST_INTENT, handleIntent);
}
