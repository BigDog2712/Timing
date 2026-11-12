/**
 * Timing — 外观 store（[V0.2.2] 文字 / 背景不透明度 · [V0.11.0] 悬浮形态）
 * -----------------------------------------------------------------------------
 * 只存前端本地（localStorage，同一 WebView2 profile 跨窗口共享），不写 Rust
 * settings 表：这几项是纯显示偏好，不参与提醒 / 统计 / 快捷键等业务判定。
 * 生效方式：把数值写到 <html> 内联自定义属性，CSS 侧只认 --ui-text-opacity /
 * --ui-bg-opacity 两个令牌（design-tokens.css §0）。
 *
 * [V0.11.0] `floatForm` 是「常驻形态」而不是「当前形态」：
 *   - `bar`：常驻悬浮条（默认）；
 *   - `dot`：常驻小圆点，启动即收起。点圆点仍可临时展开成条，那是运行时状态
 *     （`uiStore.collapsed`），不回写这里——否则用户临时看一眼条，形态就被改掉了。
 * 落盘后同步一次 `uiStore.collapsed`，让"改了立刻看得见"，不必重启。
 */
import { create } from 'zustand';
import { isKeyEvent } from '../lib/storageKeys';
import {
  type Appearance,
  type FloatForm,
  DEFAULT_APPEARANCE,
  FLOAT_FORM_OPTIONS,
  TEXT_OPACITY_MIN,
  readPillAppearance,
  writePillAppearance,
} from '../lib/pillAppearance';
import { useUiStore } from './uiStore';

/* [V0.5.0] 键名只有一处口径（lib/storageKeys.ts）：`timing.appearance.v1`，
   老键 `tickbar.appearance.v1` 只读回落。本文件不再出现键字面量。
   [0.12.1 T04] 读 / 写 / 归一化整体搬到 `lib/pillAppearance.ts`：主界面设置页（分析窗）
   也要写同一个键，而它读不到本文件（zustand + 副作用，L9 双窗隔离）。本文件只剩
   「store 的壳」：状态、落 DOM 令牌、形态与 `collapsed` 的联动。 */

/* 常量与类型从这里原样转出去：既有调用点（`components/settings/AppearanceCard.tsx`
   等）继续按老路径 import，不必跟着改。 */
export { DEFAULT_APPEARANCE, FLOAT_FORM_OPTIONS, TEXT_OPACITY_MIN };
export type { Appearance, FloatForm } from '../lib/pillAppearance';

/** 把常驻形态落到运行时（`collapsed` 只在这一处由形态决定，其余时候归用户点击） */
function applyFloatForm(form: FloatForm): void {
  useUiStore.getState().setCollapsed(form === 'dot');
}

/** 把数值写到 <html> 内联变量（CSS 只读令牌，不直接读 store） */
export function applyAppearance(value: Pick<Appearance, 'textOpacity' | 'bgOpacity'>): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-text-opacity', value.textOpacity.toFixed(2));
  root.style.setProperty('--ui-bg-opacity', value.bgOpacity.toFixed(2));
}

interface AppearanceStore extends Appearance {
  setTextOpacity: (value: number) => void;
  setBgOpacity: (value: number) => void;
  /** [V0.11.0] 切换常驻形态（立即收起 / 展开，不重启） */
  setFloatForm: (value: FloatForm) => void;
  reset: () => void;
}

export const useAppearanceStore = create<AppearanceStore>((set) => {
  /** 落盘（`lib/pillAppearance` 里那唯一一条写路径）+ 立即生效（同窗口内玻璃面同帧跟随） */
  const commit = (patch: Partial<Appearance>) => {
    const next = writePillAppearance(patch);
    set(next);
    applyAppearance(next);
    /* 形态变了才动 collapsed：拖动不透明度滑杆不该把用户展开的条收起来 */
    if (patch.floatForm !== undefined) applyFloatForm(next.floatForm);
  };

  return {
    ...readPillAppearance(),
    setTextOpacity: (value) => commit({ textOpacity: value }),
    setBgOpacity: (value) => commit({ bgOpacity: value }),
    setFloatForm: (value) => commit({ floatForm: value }),
    reset: () => commit(DEFAULT_APPEARANCE),
  };
});

/**
 * [V0.12.1] 从 localStorage **幂等重读**一次外观（跨顶层 WebView 的唯一可证通道）。
 *
 * 为什么需要它：`storage` 事件在 WebView2 里跨顶层 WebView（药丸 ← / patina 设置页）
 * **不保证投递**，不能当唯一通道。`lib/appearanceSync.ts` 在 focus / pointerenter /
 * visibilitychange 上调本函数——"人回到药丸窗口"即重读，最长延迟 = 一次焦点切换。
 *
 * @returns 是否真的变了。没变就什么都不做：药丸每次 mouseenter 都会调它，
 *   每次都 `setState` 会让药丸跟着鼠标抖。
 */
export function rereadAppearance(): boolean {
  const prev = useAppearanceStore.getState();
  const next = readPillAppearance();
  if (
    next.textOpacity === prev.textOpacity &&
    next.bgOpacity === prev.bgOpacity &&
    next.floatForm === prev.floatForm
  ) {
    return false;
  }
  useAppearanceStore.setState(next);
  applyAppearance(next);
  /* 只有形态真变了才重置收起态：别窗只是拖了一下不透明度滑杆，不该把本窗临时展开的条收回去 */
  if (next.floatForm !== prev.floatForm) applyFloatForm(next.floatForm);
  return true;
}

/**
 * 启动时套用一次，并监听其它窗口的改动（设置窗调整后，小条 / 便利贴窗即时跟随）。
 */
export function initAppearance(): void {
  const current = useAppearanceStore.getState();
  applyAppearance({ textOpacity: current.textOpacity, bgOpacity: current.bgOpacity });
  /* [V0.11.0] 首帧就按常驻形态决定是否收起：放到渲染前做，避免"先闪一条再变圆点" */
  applyFloatForm(current.floatForm);

  window.addEventListener('storage', (event) => {
    /* 新键与老键都算：升级前仍开着的旧窗口可能还在写老键 */
    if (!isKeyEvent('appearance', event.key)) return;
    /* [V0.12.1] 与 focus / pointerenter 通道共用同一条重读路径（含"没变不动"的判定），
       否则两处各写一遍 clamp + 形态判定，迟早分叉。 */
    rereadAppearance();
  });
}
