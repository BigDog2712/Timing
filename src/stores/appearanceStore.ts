/**
 * Timing — 外观 store（[V0.2.2] 文字 / 背景不透明度）
 * -----------------------------------------------------------------------------
 * 只存前端本地（localStorage，同一 WebView2 profile 跨窗口共享），不写 Rust
 * settings 表：这两项是纯显示偏好，不参与提醒 / 统计 / 快捷键等业务判定。
 * 生效方式：把数值写到 <html> 内联自定义属性，CSS 侧只认 --ui-text-opacity /
 * --ui-bg-opacity 两个令牌（design-tokens.css §0）。
 */
import { create } from 'zustand';

const STORAGE_KEY = 'timing.appearance.v1';

/** 文字不透明度的下限：再低正文就看不清了 */
export const TEXT_OPACITY_MIN = 0.2;

export interface Appearance {
  /** 文字不透明度 0.2–1（1 = 全实） */
  textOpacity: number;
  /** 背景板不透明度 0–1（0 = 全透） */
  bgOpacity: number;
}

export const DEFAULT_APPEARANCE: Appearance = { textOpacity: 1, bgOpacity: 1 };

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return max;
  return Math.min(max, Math.max(min, value));
}

function readStored(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** 把数值写到 <html> 内联变量（CSS 只读令牌，不直接读 store） */
export function applyAppearance(value: Appearance): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-text-opacity', value.textOpacity.toFixed(2));
  root.style.setProperty('--ui-bg-opacity', value.bgOpacity.toFixed(2));
}

interface AppearanceStore extends Appearance {
  setTextOpacity: (value: number) => void;
  setBgOpacity: (value: number) => void;
  reset: () => void;
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => {
  /** 落盘 + 立即生效（同窗口内所有玻璃面同帧跟随） */
  const commit = (patch: Partial<Appearance>) => {
    const next: Appearance = {
      textOpacity: clamp(patch.textOpacity ?? get().textOpacity, TEXT_OPACITY_MIN, 1),
      bgOpacity: clamp(patch.bgOpacity ?? get().bgOpacity, 0, 1),
    };
    set(next);
    applyAppearance(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* 隐私模式 / 配额满：本次会话内仍生效，不打断用户操作 */
    }
  };

  return {
    ...readStored(),
    setTextOpacity: (value) => commit({ textOpacity: value }),
    setBgOpacity: (value) => commit({ bgOpacity: value }),
    reset: () => commit(DEFAULT_APPEARANCE),
  };
});

/**
 * 启动时套用一次，并监听其它窗口的改动（设置窗调整后，小条 / 便利贴窗即时跟随）。
 */
export function initAppearance(): void {
  const current = useAppearanceStore.getState();
  applyAppearance({ textOpacity: current.textOpacity, bgOpacity: current.bgOpacity });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const next = readStored();
    useAppearanceStore.setState(next);
    applyAppearance(next);
  });
}
