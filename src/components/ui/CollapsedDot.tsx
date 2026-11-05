/**
 * Timing — 收起圆点 CollapsedDot（collapsed.md · V0.11.0 重制）
 * -----------------------------------------------------------------------------
 * [V0.11.0] 从「一枚空心环」升级成**环 + 时间**：与手机端 `TimerRing` 同一个视觉语言
 * （环在外、时分在里、状态由环色与弧长表达），只是尺寸按桌面角落的占位重定。
 * 用户口径：「移植手机端小圆点功能，复现环 + 分钟显示时间效果并保持一致」。
 *
 * 几何：外径 76、描边 3、半径 33。手机是 232/8（3.4%），桌面按同比例取 2.6 向上归整到 3
 * ——再细在 100% DPI 的透明窗里会被 Chromium 吸附掉半个像素。
 * 时间字号两档：`MM:SS` 用 15px，跨小时 `HH:MM:SS` 降到 11px（8 个字符塞不进 76px 的圆）。
 *
 * 语义复用 `MainButton.arcSpec`（ADR-024 裁决过的四条规则）：
 *   倒计时只收缩 / 正计时 90° 短弧行进 / 暂停 270° 静弧 / 结束整周加粗。
 * **不在这里另立一套**——圆点、悬浮条、手机，看到的是同一个「环在说什么」。
 *
 * 交互：单击展开回悬浮条；右键只吞事件（V0.3.1 起不再弹菜单）；
 * hover 由原生 title 显示「时长 · 事项名」。
 */
import type { MouseEvent as ReactMouseEvent } from 'react';
import { COUNTDOWN_WARN_SEC } from '../../lib/constants';
import { formatDuration, hasHours } from '../../lib/format';
import { arcDashArray, arcDashOffset, isArcVisible } from '../../lib/ringGeometry';
import { useEndedFlash } from '../../hooks/useEndedFlash';
import { useTimerTick } from '../../hooks/useTimerTick';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useCountdownArmStore } from '../../stores/countdownArm';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { toVisualState } from '../../types/ui';
import { arcSpec } from '../pill/MainButton';

const SIZE = 76;
const CENTER = SIZE / 2;
const RADIUS = 33;
const STROKE = 3;

export function CollapsedDot() {
  const seconds = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const sessionItemId = session?.itemId ?? null;
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const armedSec = useCountdownArmStore((s) => s.armedSec);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);

  /* 结束态 900ms（与药丸同源）：窗口判定在 hook 里，折叠→展开不会重放旧时间戳 */
  const ended = useEndedFlash();

  const visual = toVisualState(status, ended);
  const currentItemId = status === 'idle' ? lastItemId : sessionItemId;
  const name = findItem(items, currentItemId)?.name ?? '未归类';

  /* 与 PillBar 同一套读数口径：倒计时显示剩余、空闲但已定时长显示该时长、否则正计时秒数 */
  const isCountdown = session?.mode === 'countdown' && session.targetSec != null;
  const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - seconds) : 0;
  const armedIdle = status === 'idle' && armedSec != null;
  const displaySec = isCountdown ? remaining : armedIdle ? (armedSec ?? 0) : seconds;

  const progress = isCountdown && session?.targetSec ? remaining / session.targetSec : 1;
  const arc = arcSpec(visual, isCountdown || armedIdle, progress);
  /* 倒计时剩最后 60s：环切红（与小条同一阈值，令牌 --color-danger） */
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;
  /* frac 归零时不画 bar：round linecap 会留下一个直径 = 描边宽的亮点（同 MainButton / TimerRing） */
  const showBar = isArcVisible(arc.frac);
  const text = formatDuration(displaySec);

  /* [V0.3.1] 右键主菜单已删除：圆点右键只吞事件，不再弹菜单 */
  const handleContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  };

  return (
    <button
      type="button"
      className="dot"
      data-state={visual}
      data-countdown={isCountdown || armedIdle ? 'true' : 'false'}
      data-warn={nearEnd ? 'true' : 'false'}
      data-spin={arc.march ? 'true' : 'false'}
      data-long={hasHours(displaySec) ? 'true' : 'false'}
      title={`${text} · ${name}`}
      aria-label={`收起状态：${text} · ${name}，单击展开`}
      onClick={toggleCollapsed}
      onContextMenu={handleContextMenu}
    >
      <svg className="dot__svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        {arc.track && (
          <circle className="dot__track" cx={CENTER} cy={CENTER} r={RADIUS} strokeWidth={STROKE} />
        )}
        {showBar && (
          <circle
            className="dot__bar"
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            strokeWidth={arc.thick ? STROKE + 1 : STROKE}
            pathLength={100}
            strokeDasharray={arcDashArray(arc.frac, arc.march)}
            strokeDashoffset={arc.march ? 0 : arcDashOffset(arc.frac)}
            /* 从 12 点起顺时针（与 TimerRing 同一条旋转口径） */
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        )}
      </svg>
      <span className="dot__time">{text}</span>
    </button>
  );
}
