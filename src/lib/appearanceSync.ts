/**
 * Timing — 外观 / 手柄绑定的「从真源重读」（[0.12.1 归一] 单一真源）
 * -----------------------------------------------------------------------------
 * 真源是宿主设置表（Rust `timing.pill_prefs`），所以本窗要做的只有一件事：**去读**。
 * 读的时机有三类：
 *
 *  1. `focus` / `pointerenter` / `visibilitychange`：用户回到悬浮条了。这三条是**可证**的
 *     主通道（`alwaysOnTop` 未获焦时没有 focus，但鼠标进入一定有 pointerenter；挂
 *     `document` 而不是 `window`，因为 pointerenter 不冒泡、只向元素链派发）。
 *  2. 收到 `PILL_PREFS_EVENT`：设置页刚写完库，发了个无载荷信号（两窗同屏时不用等焦点切换）。
 *  3. 安装后立刻一次：冷启动时库里的值可能比本地缓存新。
 *
 * 为什么读的过程要**注入**（`PillPrefsSource`）：本文件在 `src/lib/`，L9 禁止 lib import
 * `src/platform/`（那是分析窗侧）。由 `main.tsx` 把网关的 `loadPillPrefs` 传进来，
 * 依赖方向就仍是「入口 → lib」，而不是 lib 反向依赖传输层。
 *
 * 幂等是硬要求：`pointerenter` 每进一次手柄区就触发一次，如果每次都 setState，药丸会跟着
 * 鼠标抖。`rereadAppearance()` 内部先比对、没变直接 return；手柄订阅侧同样「全等就返回
 * 旧引用」，让 React 跳过重渲染。所以这里写缓存 + 重读，不直接碰 React 状态。
 */
import { listen } from '@tauri-apps/api/event';
import { rereadAppearance } from '../stores/appearanceStore';
import { saveHandleBindings } from './handleBindings';
import { PILL_PREFS_EVENT, writePillAppearance } from './pillAppearance';
import type { PillPrefs } from './pillAppearance';

type RereadListener = () => void;

/** 手柄绑定的重读订阅者（`useHandleBindings` 挂在上面，不放进 zustand：避免第二个写入方） */
const handleListeners = new Set<RereadListener>();

let installed = false;

/** 并发序号：只认最后一次 refresh 的结果，早发的旧结果直接丢弃（慢请求不能盖掉新值）。 */
let inflight = 0;

/** 真源读取器。没注入时（手机端 / 单测）退化成「只重读本窗缓存」，见 `installAppearanceSync`。 */
export interface PillPrefsSource {
  load: () => Promise<PillPrefs | null>;
}

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
 * 把真源的值落到本窗：**先写本窗缓存，再走同一条重读路径**。
 *
 * 写缓存不是「多存一份真源」，而是让下一次冷启动的首帧就对（`main.tsx` 启动时同步读它）。
 * 两条重读路径内部都有「没变就不 setState」，重复收到同值不会抖。
 */
function applyPrefs(prefs: PillPrefs): void {
  writePillAppearance(prefs.appearance);
  saveHandleBindings(prefs.handles);
  rereadAppearance();
  rereadHandles();
}

/** 没有真源时的退化路径：只重读本窗缓存（手机端 / 单测：没有宿主设置表可读）。 */
function rereadLocal(): void {
  rereadAppearance();
  rereadHandles();
}

/**
 * 装一次（`main.tsx` 在 `initAppearance()` 之后调用）。
 *
 * 幂等：重复调用只保留第一份监听器（StrictMode 双次挂载、HMR 都不会重复注册）。
 * `storage` 事件**不在这里**装：`appearanceStore.initAppearance()` 已装过，那是同窗快路径。
 */
export function installAppearanceSync(source?: PillPrefsSource): void {
  if (installed) return;
  installed = true;

  /**
   * 去真源读一次。
   *
   * `null`（没有 / 不可用 / 坏形状）时**什么都不做**：保留现值，绝不拿默认值盖掉用户设置。
   */
  const refresh = (): void => {
    if (!source) {
      rereadLocal();
      return;
    }
    const mine = ++inflight;
    void source
      .load()
      .then((prefs) => {
        /* 只认最后一次：慢请求回来时用户可能已经改了新的值 */
        if (!prefs || mine !== inflight) return;
        applyPrefs(prefs);
      })
      .catch(() => undefined);
  };

  window.addEventListener('focus', refresh);
  document.addEventListener('pointerenter', refresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  /* 非 Tauri 宿主（浏览器 mock / 单测）没有注入对象，`listen` 会 reject：
     吞掉即可，三条时间信号仍在，功能退化但不崩。 */
  void listen(PILL_PREFS_EVENT, refresh).catch(() => undefined);

  /* 安装即对齐一次：冷启动时库里的值可能比本窗缓存新（另一窗改过、或本窗缓存是迁移前的） */
  refresh();
}
