/**
 * Timing — 跨窗外观 / 手柄绑定的幂等重读（T2 的落地形状）
 * -----------------------------------------------------------------------------
 * 要解决的问题：设置页在**分析窗**（顶层另一个 WebView），药丸在**主窗**。用户改完
 * 手柄绑定或外观，药丸必须生效，但 `storage` 事件是否跨顶层 WebView 投递**不是我们能
 * 保证的行为**（N9：不许把可证性建立在它上面）。
 *
 * 所以主通道改成"人回来就重读"：`focus` / `pointerenter` / `visibilitychange` 三个信号
 * 都指向同一件事——用户已经回到药丸窗口了。而用户改完设置**必然**要回到药丸才能看见
 * 效果，于是"最长延迟 = 一次焦点切换"是可证的；零新增 Tauri 事件、零轮询。
 *
 * 幂等是硬要求：`pointerenter` 每进一次手柄区就触发一次重读，如果每次都 setState，
 * 药丸会跟着鼠标抖。所以 `rereadAppearance()` 内部先比对、没变直接 return；手柄
 * 订阅侧同样"全等就返回旧引用"，让 React 跳过重渲染。
 */
import { rereadAppearance } from '../stores/appearanceStore';

type RereadListener = () => void;

/** 手柄绑定的重读订阅者（`useHandleBindings` 挂在上面，不放进 zustand：避免第二个写入方） */
const handleListeners = new Set<RereadListener>();

let installed = false;

/** 订阅「该重读手柄绑定了」。返回退订函数（`useEffect` 直接 return 它）。 */
export function subscribeHandleReread(listener: RereadListener): () => void {
  handleListeners.add(listener);
  return () => {
    handleListeners.delete(listener);
  };
}

/**
 * 装一次（`main.tsx` 在 `initAppearance()` 之后调用）。
 *
 * 幂等：重复调用只保留第一份监听器（StrictMode 的双次挂载、HMR 都不会重复注册）。
 * `storage` 事件**不在这里**再装一遍：`appearanceStore.initAppearance()` 已经装过，
 * 它是快路径；这里三个信号是**可证的主通道**。
 */
export function installAppearanceSync(): void {
  if (installed) return;
  installed = true;

  const reread = () => {
    rereadAppearance();
    for (const listener of handleListeners) listener();
  };

  window.addEventListener('focus', reread);
  /* alwaysOnTop 未获焦时窗口不会有 focus，但鼠标进入一定有 pointerenter。
     挂 `document` 而不是 `window`：pointerenter 不冒泡，规范只向**元素链**（含 document）
     派发，window 不在那条链上。 */
  document.addEventListener('pointerenter', reread);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reread();
  });
}
