/**
 * 「导航点某个锚点 → 先把托管它的折叠块展开」的模块内信号（[B5c]）
 * -----------------------------------------------------------------------------
 * 为什么需要它：`s-pill-handles`（把手绑定）从 B5c 起是一个**默认折叠**的块。导航点它时，
 * 若块是收起的，用户看到的是"跳过去什么也没有"，而 `scrollIntoView` 本身不会报错。
 * 所以跳转必须**先展开、再滚动**。
 *
 * ## 为什么是模块内信号而不是把状态提上去
 *
 * 两条路都可行，选这条的理由是**改动面**：
 *   · 提升状态 = `Settings` 要持有 `openPillHandles`，再往下传三层（Settings → SettingsHandlesPanel
 *     → FoldBlock），折叠语义从「块自己的事」变成「页级状态」；而 `FoldBlock` 现有的六个调用点
 *     （数据卡的六块）都不需要这个能力。
 *   · 模块内信号 = `SettingsGroupNav` 发一句「我要去 X」，托管 X 的那个 `FoldBlock` 自己展开。
 *     谁的块谁负责，`FoldBlock` 的 props 一个没加，其余调用点零改动。
 *
 * ## 边界（这是它不变成第二个全局状态的理由）
 *
 * - **只传锚点 id，不传"要不要展开"之外的任何东西**：没有 `state`、没有订阅快照，读不到历史。
 * - **不持久化**：展开状态按既有口径「默认折叠、不记忆」（V0.11.26），所以刷新 / 重进页面后
 *   回到折叠态是**正确行为**，不是丢状态。
 * - **同步派发**：`requestFoldReveal` 在调用栈内同步跑完所有监听者，配合 `SettingsGroupNav`
 *   里的 `flushSync`，保证"展开"在测量落点**之前**已经进 DOM。
 */
type RevealListener = (anchorId: string) => void;

const listeners = new Set<RevealListener>();

/**
 * 请求：把托管 `anchorId` 的折叠块展开（已经展开时是幂等的）。
 *
 * 没有监听者时**静默无操作**：任何锚点都可以被请求，没人托管就等于"这里没有折叠块"。
 * 这也是既有导航用例（不挂 `FoldBlock`）不受影响的原因。
 */
export function requestFoldReveal(anchorId: string): void {
  /* 拷贝一份再遍历：监听者在回调里退订（卸载）不会打断本轮派发 */
  for (const listener of [...listeners]) listener(anchorId);
}

/** 订阅展开请求；返回退订函数（`useEffect` 直接 return 它）。 */
export function onFoldRevealRequested(listener: RevealListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
