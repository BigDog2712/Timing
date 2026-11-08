/**
 * Timing — 悬浮窗那一按的接收端（V0.11.22）
 * -----------------------------------------------------------------------------
 * ## 一条链，三个环节
 *
 * ```text
 * PillService.onTap()            原生：只有「有人按了一下」这个事实
 *   └─ Plugin.trigger('pill:toggle')   Tauri 的插件事件，只投给注册过的 JS channel
 *        └─ 本 hook                     → useTimerActions().togglePause()
 *             └─ Rust 计时服务（唯一状态机）→ 写库 → 悬浮窗 500ms 后读库自见
 * ```
 *
 * ## 为什么不让 Kotlin 直接改计时
 *
 * 那条路要在原生层再写一遍「开始 / 暂停 / 继续」，等于把计时口径复制出第二份
 * （30 秒最短记录、跨零点拆分、倒计时第二段没有目标值这些规则全在 Rust）。老安卓工程
 * 被归档的直接原因就是两份口径。所以这里只做转发。
 *
 * ## 为什么用 `addPluginListener` 而不是 `listen`
 *
 * `listen()` 走的是 Rust 的事件系统（`app.emit`），而 Kotlin 的 `Plugin.trigger` 只投给
 * **本插件**通过 `plugin:…|registerListener` 注册的 channel。两者不是一条路——
 * 用 `listen` 会得到一个永远不响的回调，而且毫无提示。
 *
 * 原生侧在投递前会问一句 `hasListener('pill:toggle')`：问不到（WebView 已经销毁 / 本 hook
 * 没挂上）就退回「打开主界面」，宁可多一步也不静默失效。
 */
import { useEffect } from 'react';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { useTimerActions } from './useTimerActions';
import { IS_MOBILE } from '../lib/platform';
import { isTauri } from '../services/ipc';

/** 与 `PillService.EVENT_TOGGLE` 必须一致（改一处就要改两处，Kotlin 侧有同名常量注释）。 */
const PILL_TOGGLE_EVENT = 'pill:toggle';

export function usePillAction(): void {
  const { togglePause } = useTimerActions();

  useEffect(() => {
    if (!IS_MOBILE || !isTauri()) return;
    let alive = true;
    let listener: PluginListener | null = null;

    void addPluginListener('timing-native', PILL_TOGGLE_EVENT, () => {
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
           会退回「打开主界面」。这里不报错，避免桌面端出现奇怪的红字。 */
      });

    return () => {
      alive = false;
      const current = listener;
      listener = null;
      void current?.unregister();
    };
  }, [togglePause]);
}
