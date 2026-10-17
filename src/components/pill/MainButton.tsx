/**
 * TickBar — 圆形状态环按钮 RingButton（药丸左侧核心）
 * -----------------------------------------------------------------------------
 * 规格（2026-10-16 UI 统一：对齐 Timing MainForm.DrawRing 实测）：
 *   环 ⌀16（--ring-size）、描边 2.4（--ring-stroke），命中区经 CSS ::before 扩到 ⌀24。
 *   状态由「环色 + 弧形」承载（Timing 同款，环内不放图标——图标锁 16/20/24 档，⌀16 环不容）：
 *   - idle    ：全圆静环（--state-idle）
 *   - running ：90° 亮弧 + CSS 旋转动画（3.2s/圈；底环 = 同色 35% 轨道）
 *   - paused  ：270° 静弧（--color-warn；Timing RingPause 暖橙）
 *   - countdown：递减弧（remaining/target），warn 时切 --color-warn
 *   - ended   ：全圆 --color-done 加粗（900ms 瞬时确认）
 * 键盘：Space 开始/暂停、Enter 结束（在 PillBar 容器统一处理）。
 */
import type { VisualState } from '../../types/ui';

/** SVG 弧几何：viewBox 0 0 16 16，r = (16 - stroke 2.4) / 2 = 6.8，周长 2πr */
const ARC_R = 6.8;
const ARC_LEN = 2 * Math.PI * ARC_R;

/** 弧配置：frac = 可见弧比例；track = 是否渲染 SVG 底轨（旋转弧由 CSS 动画驱动） */
interface ArcSpec {
  frac: number;
  track: boolean;
}

function arcSpec(state: VisualState, countdown: boolean, progress: number): ArcSpec | null {
  if (countdown) {
    return { frac: Math.max(0, Math.min(1, progress)), track: true };
  }
  if (state === 'running') return { frac: 0.25, track: false };
  if (state === 'paused') return { frac: 0.75, track: false };
  return null; // idle / ended → 纯 border 全圆
}

interface MainButtonProps {
  state: VisualState;
  label: string;
  onClick: () => void;
  /** [V0.2.0] 倒计时模式：色环显示递减弧 */
  countdown?: boolean;
  /** [V0.2.0] 剩余比例（0..1，= remaining / targetSec） */
  progress?: number;
  /** [V0.2.0] 接近到点（剩余 ≤ 阈值）→ 弧色切 warn */
  warn?: boolean;
}

export function MainButton({ state, label, onClick, countdown = false, progress = 1, warn = false }: MainButtonProps) {
  const arc = arcSpec(state, countdown, progress);

  return (
    <button
      type="button"
      className="ring"
      data-state={state}
      data-countdown={countdown ? 'true' : 'false'}
      data-warn={warn ? 'true' : 'false'}
      onClick={onClick}
      aria-label={label}
    >
      {arc && (
        <svg className="ring__arc" viewBox="0 0 16 16" aria-hidden>
          {arc.track && <circle className="ring__arc-track" cx="8" cy="8" r={ARC_R} />}
          <circle
            className="ring__arc-bar"
            cx="8"
            cy="8"
            r={ARC_R}
            strokeDasharray={ARC_LEN}
            strokeDashoffset={ARC_LEN * (1 - arc.frac)}
          />
        </svg>
      )}
    </button>
  );
}
