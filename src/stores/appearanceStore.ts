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
import { isKeyEvent, readKeyWithLegacy, writeKey } from '../lib/storageKeys';
import { useUiStore } from './uiStore';

/* [V0.5.0] 键名只有一处口径（lib/storageKeys.ts）：`timing.appearance.v1`，
   老键 `tickbar.appearance.v1` 只读回落。本文件不再出现键字面量。 */

/** 文字不透明度的下限：再低正文就看不清了 */
export const TEXT_OPACITY_MIN = 0.2;

/** [V0.11.0] 常驻悬浮形态：悬浮条 / 小圆点 */
export type FloatForm = 'bar' | 'dot';

export const FLOAT_FORM_OPTIONS: readonly { id: FloatForm; label: string }[] = [
  { id: 'bar', label: '悬浮条' },
  { id: 'dot', label: '小圆点' },
];

export interface Appearance {
  /** 文字不透明度 0.2–1（1 = 全实） */
  textOpacity: number;
  /** 背景板不透明度 0–1（0 = 全透） */
  bgOpacity: number;
  /** [V0.11.0] 常驻形态（`bar` 默认） */
  floatForm: FloatForm;
}

export const DEFAULT_APPEARANCE: Appearance = { textOpacity: 1, bgOpacity: 1, floatForm: 'bar' };

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return max;
  return Math.min(max, Math.max(min, value));
}

/** 只认两个字面量：存进来别的东西（旧版没有这个键、手改坏了）一律回落到悬浮条 */
function normalizeFloatForm(value: unknown): FloatForm {
  return value === 'dot' ? 'dot' : 'bar';
}

function readStored(): Appearance {
  try {
    const raw = readKeyWithLegacy('appearance');
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      textOpacity:
        typeof parsed.textOpacity === 'number'
          ? clamp(parsed.textOpacity, TEXT_OPACITY_MIN, 1)
          : DEFAULT_APPEARANCE.textOpacity,
      bgOpacity:
        typeof parsed.bgOpacity === 'number'
          ? clamp(parsed.bgOpacity, 0, 1)
          : DEFAULT_APPEARANCE.bgOpacity,
      floatForm: normalizeFloatForm(parsed.floatForm),
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

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

export const useAppearanceStore = create<AppearanceStore>((set, get) => {
  /** 落盘 + 立即生效（同窗口内所有玻璃面同帧跟随） */
  const commit = (patch: Partial<Appearance>) => {
    const next: Appearance = {
      textOpacity: clamp(patch.textOpacity ?? get().textOpacity, TEXT_OPACITY_MIN, 1),
      bgOpacity: clamp(patch.bgOpacity ?? get().bgOpacity, 0, 1),
      floatForm: normalizeFloatForm(patch.floatForm ?? get().floatForm),
    };
    set(next);
    applyAppearance(next);
    writeKey('appearance', JSON.stringify(next));
    /* 形态变了才动 collapsed：拖动不透明度滑杆不该把用户展开的条收起来 */
    if (patch.floatForm !== undefined) applyFloatForm(next.floatForm);
  };

  return {
    ...readStored(),
    setTextOpacity: (value) => commit({ textOpacity: value }),
    setBgOpacity: (value) => commit({ bgOpacity: value }),
    setFloatForm: (value) => commit({ floatForm: value }),
    reset: () => commit(DEFAULT_APPEARANCE),
  };
});

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
    const next = readStored();
    const formChanged = next.floatForm !== useAppearanceStore.getState().floatForm;
    useAppearanceStore.setState(next);
    applyAppearance(next);
    /* [V0.11.2] 只有形态真变了才重置收起态。原先无条件 `applyFloatForm`：
       别窗只是拖了一下不透明度滑杆，本窗「临时展开的小条」也会被按常驻形态收回圆点。 */
    if (formChanged) applyFloatForm(next.floatForm);
  });
}
