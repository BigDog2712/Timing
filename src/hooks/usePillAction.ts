/**
 * Timing — 悬浮窗那一按的接收端（V0.11.22；[V0.11.27] 加兜底通道）
 * -----------------------------------------------------------------------------
 * ## 一条链，三个环节
 *
 * ```text
 * PillService.onTap()            原生：只有「有人按了一下」这个事实
 *   ├─ Prefs.markPendingTap()        先留一个标记（90 秒内有效）
 *   └─ Plugin.trigger('pill:toggle') Tauri 的插件事件，只投给注册过的 JS channel
 *        └─ 本 hook                   → useTimerActions().togglePause()
 *             └─ Rust 计时服务（唯一状态机）→ 写库 → 推快照回悬浮条
 * ```
 *
 * ## 为什么还要那条兜底通道
 *
 * `trigger` 只在 WebView 活着且本 hook 挂着监听时有效。WebView 被销毁（用户从最近任务
 * 划掉）、或监听的注册还没落地的瞬间，事件就**静默消失**——用户看到的是「点悬浮条没反应」，
 * 而两端都不报错。
 *
 * 所以原生侧在按下的那一刻先记一个时间戳；本 hook 在**回到前台**时问一次
 * `overlayTakeTap`：标记还在就说明那一按没人接，这里补做一次。事件真的送到了的话，
 * 回调第一件事就是清标记，不会补做第二次。
 *
 * ## 为什么用 `addPluginListener` 而不是 `listen`
 *
 * `listen()` 走的是 Rust 的事件系统（`app.emit`），而 Kotlin 的 `Plugin.trigger` 只投给
 * **本插件**通过 `plugin:…|registerListener` 注册的 channel。两者不是一条路——
 * 用 `listen` 会得到一个永远不响的回调，而且毫无提示。
 */
import { useEffect } from 'react';
import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { useTimerActions } from './useTimerActions';
import { IS_MOBILE } from '../lib/platform';
import { isTauri } from '../services/ipc';

/** 与 `PillService.EVENT_TOGGLE` 必须一致（改一处就要改两处，Kotlin 侧有同名常量注释）。 */
const PILL_TOGGLE_EVENT = 'pill:toggle';

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

/** 取走尚未被接走的那一按；没有 / 太旧都算没有。 */
async function takePendingTap(): Promise<boolean> {
  try {
    const res = await invoke<{ pending?: boolean; ageMs?: number }>(
      `plugin:${PLUGIN}|overlayTakeTap`,
    );
    const age = res?.ageMs ?? -1;
    return res?.pending === true && age >= 0 && age <= PENDING_TTL_MS;
  } catch {
    /* 拿不到（桌面壳 / 插件没加载 / 老包没有这条命令）就当没有：补做不是必须能力。 */
    return false;
  }
}

export function usePillAction(): void {
  const { togglePause } = useTimerActions();

  useEffect(() => {
    if (!IS_MOBILE || !isTauri()) return;
    let alive = true;
    let listener: PluginListener | null = null;

    void addPluginListener(PLUGIN, PILL_TOGGLE_EVENT, () => {
      /* 顺序要紧：先清标记，再切换。反过来的话，切换那一两百毫秒里用户切到后台再回来，
         就会被兜底通道再切一次（同一按执行两下）。 */
      void clearPendingTap();
      /* 悬浮窗那一按的语义就是主界面大按钮：idle → 开始，running → 暂停，paused → 继续。
         失败由 `togglePause` 自己落到 notice 上，这里不吞也不重试。 */
      void togglePause();
    })
      .then((created) => {
        /* 注册是异步的：组件在注册完成前就卸载了的话，必须立刻注销，否则这个 channel
           会一直留在插件里（下次重挂载再多一份，同一按被执行 N 次）。 */
        if (alive) listener = created;
        else void created.unregister();
      })
      .catch(() => {
        /* 注册不上（桌面壳 / 插件没加载）不影响任何东西：原生侧问不到监听者，
           会退回「打开主界面」，并由标记在这里兜底。这里不报错，避免桌面端出现奇怪的红字。 */
      });

    /* 兜底通道。三个时机都试：挂载、页面变可见、窗口拿到焦点——
       安卓上「从后台回来」不保证三个都触发，押一个会漏。 */
    const drain = () => {
      void takePendingTap().then((pending) => {
        if (alive && pending) void togglePause();
      });
    };
    drain();
    const onVisible = () => {
      if (document.visibilityState === 'visible') drain();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', drain);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', drain);
      const current = listener;
      listener = null;
      void current?.unregister();
    };
  }, [togglePause]);
}
