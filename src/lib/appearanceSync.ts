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
import { listen } from '@tauri-apps/api/event';
import { rereadAppearance } from '../stores/appearanceStore';
import { saveHandleBindings } from './handleBindings';
import type { HandleBindings } from './handleCatalog';
import { PILL_PREFS_EVENT, writePillAppearance } from './pillAppearance';
import type { PillPrefsPayload } from './pillAppearance';

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

/** 让所有订阅者重读手柄绑定（"变了才 setState" 由订阅方自己判，见 `useHandleBindings`） */
function rereadHandles(): void {
  for (const listener of handleListeners) listener();
}

/**
 * 收到设置页**搬运过来**的偏好：先写进本窗这份 localStorage，再走同一条重读路径。
 *
 * 必须先写盘：本窗（悬浮条）与设置页（主界面）是两份独立的 WebView 数据目录，
 * 各读各的 localStorage（见 `PILL_PREFS_EVENT` 的注释）。不写的话，本窗一重启
 * 就退回旧值 —— 真源仍然在这里。
 *
 * 载荷来自**另一个窗口**，不可信：`saveHandleBindings` 内部会走 `parseHandleBindings`
 * 归一化（未知 id / 缺键 / 坏版本一律回落），所以这里的断言只是给类型一个名字，
 * 不是"保证它一定合法"。
 */
function applyRemotePrefs(payload: PillPrefsPayload | null | undefined): void {
  if (!payload) return;
  if (payload.appearance) {
    writePillAppearance(payload.appearance);
    /* 写盘后再读：`rereadAppearance` 内含"没变就不 setState"，所以重复收到同值不会抖 */
    rereadAppearance();
  }
  if (payload.handles) {
    saveHandleBindings(payload.handles as HandleBindings);
    rereadHandles();
  }
}

/**
 * 装一次（`main.tsx` 在 `initAppearance()` 之后调用）。
 *
 * 幂等：重复调用只保留第一份监听器（StrictMode 的双次挂载、HMR 都不会重复注册）。
 * `storage` 事件**不在这里**再装一遍：`appearanceStore.initAppearance()` 已经装过，
 * 它是快路径；这里三个信号是**可证的主通道**。
 *
 * [0.12.1 修复] 再加一条**即时**通道：设置页写完后广播 `PILL_PREFS_EVENT`，本窗收到
 * 就搬运过来。三条时间信号（focus / pointerenter / visibilitychange）只覆盖"用户回到
 * 悬浮条"，而两份 localStorage 互相看不见，光靠重读永远读不到对方那份 —— 这是
 * 「设置里怎么调都没反应」的直接原因。
 */
export function installAppearanceSync(): void {
  if (installed) return;
  installed = true;

  const reread = () => {
    rereadAppearance();
    rereadHandles();
  };

  window.addEventListener('focus', reread);
  /* alwaysOnTop 未获焦时窗口不会有 focus，但鼠标进入一定有 pointerenter。
     挂 `document` 而不是 `window`：pointerenter 不冒泡，规范只向**元素链**（含 document）
     派发，window 不在那条链上。 */
  document.addEventListener('pointerenter', reread);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reread();
  });

  /* 非 Tauri 宿主（浏览器 mock / 单测）没有注入对象，`listen` 会 reject：
     吞掉即可，三条时间信号仍在，功能退化但不崩。 */
  void listen<PillPrefsPayload>(PILL_PREFS_EVENT, (event) => {
    applyRemotePrefs(event.payload);
  }).catch(() => undefined);
}
