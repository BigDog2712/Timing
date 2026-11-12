/**
 * Timing — 窗口重新获得焦点时重拉事项列表（V0.11.7）
 * -----------------------------------------------------------------------------
 * 为什么需要它（现场根因，不是猜的）：
 * 悬浮窗（`main`）和事项窗（`todos`）是**两个独立 webview**，各有自己的一份 zustand
 * store。在任一窗口新建 / 改名事项时，只有**那个窗口自己**的 `useItemStore` 会 reload；
 * 另一个窗口停在自己的快照上。事项窗又是浮层（`useWindowLeaveHide` 只 hide 不卸载），
 * 「再打开」不重新 mount，首帧 effect 不重跑 → 事项列表一直是旧的。
 *
 * 表现极易被误读成「事项名丢了」：`itemName()` 查不到 id 就回落「未归类」，而
 * `lib/todayGroups.ts::identityOf()` 对「未归类」改用 `id:<itemId>` 当分组键，于是
 * 同一个事项的多条记录被拆成好几行、且全显示「未归类」。数据库与 Markdown 一直是好的，
 * 坏的只是**视图快照**。所以修在这里，不动存储层。
 *
 * 为什么不新增 IPC 事件：事件是契约的一部分（11 条，`check:contract` 断言），
 * 为一次「本窗该刷新了」专门加一条事件，等于把窗口生命周期泄漏进 IPC 契约。
 * 焦点是每个窗口天然拿得到的信号，收敛到这一处即可（见 ADR-052）。
 *
 * 两个信号并联（都指向「窗口可见了」）：
 *   1. `window.focus` —— 用户点回来 / 后端 `show() + set_focus()`（`infra::window`）；
 *   2. `document.visibilitychange` —— 最小化还原、被切成后台再切回来。
 * 只要有一条生效就够；任一条在某个 webview 上不灵时另一条兜底（真机验证见 CHANGELOG）。
 */
import { useEffect } from 'react';
import { useItemStore } from '../stores/itemStore';

/** 重拉事项列表；失败静默（焦点刷新是「顺手跟上」，不该弹错误提示打断用户）。 */
function reloadItems(): void {
  /* 窗口不可见时不拉：`visibilitychange` 在转 hidden 时同样会触发，
     那时刷新是白跑一次查询。 */
  if (document.visibilityState === 'hidden') return;
  void useItemStore
    .getState()
    .reload()
    .catch(() => undefined);
}

/**
 * 在**显示事项名的窗口**里挂一次：每次重新获得焦点 / 重新可见时重拉 `list_items`。
 *
 * 只挂在会显示事项名的窗口（主窗悬浮条、事项窗）。设置窗 / 便利贴窗不展示事项名，
 * 挂上只是多打一次没有消费者的查询。
 */
export function useItemsRefreshOnFocus(): void {
  useEffect(() => {
    window.addEventListener('focus', reloadItems);
    document.addEventListener('visibilitychange', reloadItems);
    return () => {
      window.removeEventListener('focus', reloadItems);
      document.removeEventListener('visibilitychange', reloadItems);
    };
  }, []);
}
