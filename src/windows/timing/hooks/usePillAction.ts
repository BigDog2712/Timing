/**
 * Timing — 悬浮条/通知按钮的接收端（V0.11.22 起；[V0.11.32] 换掉投递方式）
 * -----------------------------------------------------------------------------
 * ## 一条链，两个环节
 *
 * ```text
 * PillService.onTap() / 长按 / 通知按钮   原生：只有「用户点了哪个动作」这个事实
 *   ├─ Prefs.markPendingAction(kind)        先留一个标记（90 秒内有效，带动作类型）
 *   └─ webView.evaluateJavascript("window.__timingPillTap('toggle')")
 *        └─ 本 hook                         → 开始 / 暂停 / 继续 / 结束 / 切到计时页
 *             └─ Rust 计时服务（唯一状态机）→ 写库 → 推快照回悬浮条
 * ```
 *
 * ## 为什么不再用 `addPluginListener`（这是本轮真正要修的东西）
 *
 * 0.11.22 用的是 Tauri 的 `addPluginListener` + Kotlin `Plugin.trigger`。那条路要求两边
 * 都「注册成功」，而注册是 `plugin:timing-native|registerListener` 这个**由 Tauri 自己实现**
 * 的命令：它内部走 `invoke.parseArgs(RegisterListenerArgs::class.java)`，也就是 Jackson 反射
 * ——本仓为了躲 R8 的反射问题，早就把自己那套 `parseArgs` 换成了 `getArgs()`，却在这条链上
 * 留了个别人的反射。注册一旦失败，前端 `.catch()` 把它吞掉，Kotlin 侧 `hasListener` 永远
 * 为 false，表现就是**点按只有原生那半截反应（圆点展开），计时一动不动**，两端都不报错。
 *
 * 现在只用一条谁也拦不住的路：原生直接 `evaluateJavascript` 调这个全局函数。
 * 代价是要在 `window` 上挂一个名字，所以两端的名字必须钉死（判据在
 * `usePillAction.source.test.ts`）。
 *
 * ## 为什么还要那条兜底通道
 *
 * `evaluateJavascript` 只在 WebView 活着时有效。WebView 被销毁（用户从最近任务划掉）时
 * 这一按就只剩标记：本 hook 在**回到前台**时问一次 `overlayTakeTap`，标记还在就补做一次。
 * 事件真的送到了的话，回调第一件事就是清标记，不会补做第二次。
 */
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStopNaming } from './useStopNaming';
import { useTimerActions } from './useTimerActions';
import { IS_MOBILE } from '../lib/platform';
import { isTauri } from '../services/ipc';
import { useMobileUiStore } from '../stores/mobileUiStore';
import { useTimerStore } from '../stores/timerStore';
import { SYSTEM_ITEM_ID } from '../types/domain';

/**
 * 原生调进来的全局函数名。**必须**与 `PillService.JS_ENTRY` 逐字一致——
 * 两边各写一份字符串，改一处忘另一处的表现是「点了没反应」，而且两边都不报错。
 */
const PILL_ENTRY = '__timingPillTap';

/** 三个动作类型。与 `PillService.KIND_*` 必须一致：标记里存的就是这三个词。 */
const KIND_TOGGLE = 'toggle';
const KIND_FINISH = 'finish';
/** [V0.11.32] 长按进 App：原生照旧 `startActivity`，这里只负责把落点切到计时页。 */
const KIND_OPEN = 'open';

/** 插件名（`lib.rs` 里 `Builder::new("timing-native")`）。 */
const PLUGIN = 'timing-native';

/**
 * 多老的一按还算数。
 *
 * 不定这个上限的话，昨天按的那一下会在今天打开 App 时突然把计时切一次——比不补做更糟。
 * 90 秒足够覆盖「点完悬浮条 → 系统把 App 拉起来 → 首帧渲染完」这段，也不会长到误伤。
 */
const PENDING_TTL_MS = 90_000;

/** 告诉原生「这一按已经有人接了」，免得回前台时再补一次。失败无所谓：最坏是补做一次。 */
async function clearPendingTap(): Promise<void> {
  await invoke(`plugin:${PLUGIN}|overlayClearTap`).catch(() => undefined);
}

/** `overlayTakeTap` 的回值。`action` 是 0.11.28 才有的，老包给不出（按 toggle 处理）。 */
interface TakenTap {
  pending?: boolean;
  ageMs?: number;
  action?: string;
}

/** 取走尚未被接走的动作；没有 / 太旧都算没有。返回动作类型，`null` = 无事可做。 */
async function takePendingTap(): Promise<string | null> {
  try {
    const res = await invoke<TakenTap>(`plugin:${PLUGIN}|overlayTakeTap`);
    const age = res?.ageMs ?? -1;
    if (res?.pending !== true || age < 0 || age > PENDING_TTL_MS) return null;
    const action = res.action ?? '';
    if (action === KIND_FINISH || action === KIND_OPEN) return action;
    /* 0.11.27 的包只投 toggle，回值里没有 action —— 空串按 toggle 处理是正确的。 */
    return KIND_TOGGLE;
  } catch {
    /* 拿不到（桌面壳 / 插件没加载 / 老包没有这条命令）就当没有：补做不是必须能力。 */
    return null;
  }
}

export function usePillAction(): void {
  const { togglePause, start } = useTimerActions();
  const stopWithNaming = useStopNaming();

  useEffect(() => {
    if (!IS_MOBILE || !isTauri()) return;
    let alive = true;

    /**
     * 执行一个动作。
     *
     * 顺序要紧：**先清标记，再执行**。反过来的话，执行那一两百毫秒里用户切到后台再回来，
     * 兜底通道会看到标记还在，于是同一按被执行两下（表现是「点一下暂停又继续」）。
     */
    const run = async (kind: string): Promise<void> => {
      await clearPendingTap();
      if (kind === KIND_OPEN) {
        /* [V0.11.32] 主人要求长按「应跳转至计时界面」：原生只负责把 App 拉到前台，
           落在哪一页由这里定。顺手关掉盖在上面的面板，否则回到的是"上次那张表"。 */
        useMobileUiStore.getState().closeSheet();
        useMobileUiStore.getState().setTab('timer');
        return;
      }
      if (kind === KIND_FINISH) {
        /* 「结束」= 主界面那颗结束按钮：落库 + 撤销条 + （未命名时）补名字，同一套。 */
        await stopWithNaming();
        return;
      }
      /* [V0.11.32] 先问真值再切：App 在后台这段时间 store 里的 `status` 可能是旧的，
         拿旧值去判断「该暂停还是该继续」会发出一条必然被拒的命令，用户看到的就是
         「点了没反应」。Rust 那边才是唯一事实来源。 */
      await useTimerStore.getState().refresh().catch(() => undefined);
      if (useTimerStore.getState().state.status === 'idle') {
        /* 悬浮条上没有"选事项"的位置，所以这一按记的就是**未命名**的一笔：
           直接用系统事项「未归类」开始，结束时由 `useStopNaming` 问名字。 */
        await start(SYSTEM_ITEM_ID);
        return;
      }
      /* 其余两态就是主界面大按钮的语义：running → 暂停，paused → 继续。 */
      await togglePause();
    };

    /* 原生唯一的入口。回值只用于"有人在吗"的粗判；真正的成败由原生看标记与快照判定。 */
    const entry = (kind: string): string => {
      void run(typeof kind === 'string' ? kind : KIND_TOGGLE).catch(() => undefined);
      return 'ok';
    };
    (window as unknown as Record<string, unknown>)[PILL_ENTRY] = entry;

    /* 兜底通道。三个时机都试：挂载、页面变可见、窗口拿到焦点——
       安卓上「从后台回来」不保证三个都触发，押一个会漏。 */
    const drain = (): void => {
      void takePendingTap().then((kind) => {
        if (alive && kind) void run(kind);
      });
    };
    drain();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') drain();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', drain);

    return () => {
      alive = false;
      delete (window as unknown as Record<string, unknown>)[PILL_ENTRY];
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', drain);
    };
  }, [togglePause, start, stopWithNaming]);
}
