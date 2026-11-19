/**
 * Timing — 计时数字展示（AC-24 等宽不抖动；V0.2.0 倒计时扩展）
 * -----------------------------------------------------------------------------
 * 复用 design-tokens.css 锁定的 `.timer-digits` 规则（不可协商）：
 *   font-mono / tabular-nums / "tnum"+"zero" / min-width 5ch / 右对齐 / nowrap。
 * `>=1h` 时切 `data-hours="true"`（min-width 8ch），格式由 format.ts 统一产出。
 * [V0.2.0] `mode="countdown"` → 语义为「剩余」；`tone="warn"` → 到点前视觉提示色 --color-warn。
 * [V0.2.4 · 4] 传入 `onMenu` 时，右键这串数字 = 打开倒计时时长菜单（参照 Timing v1.7.3
 *   的 TimeZoneScreenRect：时钟数字区域右击 → CountdownMenu）。右键按下/抬起都不往上传，
 *   否则 PillBar 会把右键当成「结束并保存」。
 */
import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { clientToLayer } from '../../lib/fitBounds';
import { formatDuration, hasHours } from '../../lib/format';
import type { MenuPos } from '../../stores/uiStore';
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
  /** [V0.2.4 · 4] 右键：唤起倒计时菜单，坐标为屏幕内的锚点 */
  onMenu?: (pos: MenuPos) => void;
  /**
   * [V0.2.6] 左键（对齐 Timing v1.7.3 的 Zone.Time / OnMouseUp）：
   * 计时中 = 与圆环相同（暂停）；空闲 = 正计时 ⇄ 倒计时模式切换。
   */
  onActivate?: () => void;
  /**
   * [B4 · P2 §4.2/§4.3] 这个数字是不是「面板触发」：
   * 计时中/暂停态点数字 = 展开计时小面板，所以它要在 Tab 序列里、要能按 Enter 打开、
   * 读屏要能听出「按下去会发生什么」。
   */
  opensPanel?: boolean;
}

export function TimerDisplay({
  seconds,
  size = 'md',
  mode = 'countup',
  tone = 'default',
  className,
  onMenu,
  onActivate,
  opensPanel = false,
}: TimerDisplayProps) {
  const text = formatDuration(seconds);
  const hours = hasHours(seconds);
  const label = mode === 'countdown' ? `剩余 ${text}` : `已计时 ${text}`;
  const rightUpAt = useRef(0);

  /* [B4 · P2 §4.3] 播报**按分钟**，不每秒刷屏：
     可见文字仍是秒级（视觉上必须跳），但 live region 只在整分钟变化时改文本。
     可访问名（aria-label）保持秒级精确 —— 用于「用户主动来读」的时刻；
     两个粒度分开，才不会因为每秒改 label 把读屏刷爆。 */
  const minuteText = formatDuration(Math.floor(seconds / 60) * 60);
  const spokenBase = mode === 'countdown' ? `剩余 ${minuteText}` : `已计时 ${minuteText}`;
  /* 告警阈值切换时额外播报一次（P2 §4.3） */
  const spoken = tone === 'warn' ? `${spokenBase}，即将到点` : spokenBase;

  const openMenuAt = (clientX: number, clientY: number) => {
    /* [ADR-020] 指针是视口坐标、菜单锚点是布局坐标：置层被 translate 过，必须换算 */
    onMenu?.(clientToLayer(clientX, clientY));
  };

  const stopRight = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button === 2) e.stopPropagation();
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 2 || !onMenu) return;
    e.stopPropagation();
    e.preventDefault();
    rightUpAt.current = Date.now();
    openMenuAt(e.clientX, e.clientY);
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLSpanElement>) => {
    if (!onMenu) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - rightUpAt.current < 400) return;
    openMenuAt(e.clientX, e.clientY);
  };

  return (
    <span
      className={className ? `timer-digits ${className}` : 'timer-digits'}
      data-hours={hours ? 'true' : 'false'}
      data-size={size === 'lg' ? 'lg' : undefined}
      data-tone={tone}
      role="timer"
      /* opensPanel 时它是面板触发：进 Tab 序列、读屏听得出按下去会发生什么 */
      tabIndex={opensPanel ? 0 : undefined}
      aria-haspopup={opensPanel ? 'dialog' : undefined}
      aria-label={
        opensPanel ? `${label}（回车展开计时面板）` : onMenu ? `${label}（右键设置倒计时）` : label
      }
      onClick={onActivate}
      onKeyDown={
        opensPanel
          ? (e) => {
              /* 只认 Enter：Space 在条本体上是「开始/暂停」，不要在数字上再抢一次 */
              if (e.key !== 'Enter' || e.repeat) return;
              e.preventDefault();
              e.stopPropagation();
              onActivate?.();
            }
          : undefined
      }
      onPointerDown={onMenu ? stopRight : undefined}
      onPointerUp={onMenu ? handlePointerUp : undefined}
      onContextMenu={onMenu ? handleContextMenu : undefined}
    >
      {text}
      <span className="sr-only" role="status" aria-live="polite">
        {spoken}
      </span>
    </span>
  );
}
