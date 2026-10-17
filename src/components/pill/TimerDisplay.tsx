/**
 * TickBar — 计时数字展示（AC-24 等宽不抖动；V0.2.0 倒计时扩展）
 * -----------------------------------------------------------------------------
 * 复用 design-tokens.css 锁定的 `.timer-digits` 规则（不可协商）：
 *   font-mono / tabular-nums / "tnum"+"zero" / min-width 5ch / 右对齐 / nowrap。
 * `>=1h` 时切 `data-hours="true"`（min-width 8ch），格式由 format.ts 统一产出。
 * [V0.2.0] `mode="countdown"` → 语义为「剩余」；`tone="warn"` → 到点前视觉提示色 --color-warn。
 */
import { formatDuration, hasHours } from '../../lib/format';
import type { TimerMode } from '../../types/domain';

interface TimerDisplayProps {
  seconds: number;
  /** 展开面板大计时用 'lg'（--text-timer-lg） */
  size?: 'md' | 'lg';
  /** [V0.2.0] 计时模式（countdown → 展示「剩余」语义） */
  mode?: TimerMode;
  /** [V0.2.0] 视觉提示（倒计时接近到点 → warn 色） */
  tone?: 'default' | 'warn';
  className?: string;
}

export function TimerDisplay({ seconds, size = 'md', mode = 'countup', tone = 'default', className }: TimerDisplayProps) {
  const text = formatDuration(seconds);
  const hours = hasHours(seconds);
  const label = mode === 'countdown' ? `剩余 ${text}` : `已计时 ${text}`;
  return (
    <span
      className={className ? `timer-digits ${className}` : 'timer-digits'}
      data-hours={hours ? 'true' : 'false'}
      data-size={size === 'lg' ? 'lg' : undefined}
      data-tone={tone}
      role="timer"
      aria-label={label}
    >
      {text}
    </span>
  );
}
