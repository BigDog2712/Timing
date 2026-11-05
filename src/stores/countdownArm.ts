/**
 * Timing — 倒计时「已设定时长」（V0.2.5 · 5，对齐 Timing v1.7.3 的口径）
 * -----------------------------------------------------------------------------
 * 参照 `Timingv1.7.3\src\ElioTimer.Ui\MainForm.cs`：右键选档位**只设定时长**
 * （`countdownMode = true; countdownSeconds = 秒`，小条 idle 时 `TimeText` 直接显示该时长），
 * 点「开始」才真正倒数；所以这里单独存一个「已设定的目标时长」。
 *
 * 为什么不进 Rust settings 表：它是一次性的操作意图（选完就等开始），不是配置项；
 * 用 localStorage 持久化只为跨窗口/重启后仍然记得上次设定的档位。
 */
import { create } from 'zustand';
import { readKeyWithLegacy, removeKey, writeKey } from '../lib/storageKeys';

/* [V0.5.0] 键名统一走 lib/storageKeys.ts（`timing.countdownArm.v1` /
   `timing.countdownDuration.v1`），老键 `tickbar.countdownArm.v1` /
   `tickbar.countdownDuration.v1` 只读回落一个版本。 */
const MIN_SEC = 1;
const MAX_SEC = 5400;

export function readCountdownDuration(fallback = 1500): number {
  try {
    const raw = readKeyWithLegacy('countdownDuration');
    if (raw === null) return fallback;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= MIN_SEC && value <= MAX_SEC) return value;
  } catch { /* Use configured default when storage is unavailable. */ }
  return fallback;
}

function readArmed(): number | null {
  try {
    const raw = readKeyWithLegacy('countdownArm');
    if (!raw) return null;
    const sec = Number.parseInt(raw, 10);
    return Number.isFinite(sec) && sec >= MIN_SEC && sec <= MAX_SEC ? sec : null;
  } catch {
    return null;
  }
}

interface CountdownArmState {
  /** 已设定的倒计时时长（秒）；null = 未设定，小条按正计时显示 */
  armedSec: number | null;
  arm: (sec: number) => void;
  clear: () => void;
}

export const useCountdownArmStore = create<CountdownArmState>((set) => ({
  armedSec: readArmed(),
  arm: (sec) => {
    if (!Number.isInteger(sec) || sec < MIN_SEC || sec > MAX_SEC) return;
    set({ armedSec: sec });
    /* 写不进去只影响重启后是否记得，不影响当前操作（隐私模式 / 配额满） */
    writeKey('countdownArm', String(sec));
    writeKey('countdownDuration', String(sec));
  },
  clear: () => {
    set({ armedSec: null });
    removeKey('countdownArm');
  },
}));
