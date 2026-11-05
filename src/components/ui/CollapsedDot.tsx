/**
 * Timing — 收起圆点 CollapsedDot（V0.11.1 秒表形态）
 * -----------------------------------------------------------------------------
 * 用户口径（2026-11-05）：「环是图形语言，不应放时间，参考安卓端的图形化语言」。
 * 所以这一版把上一版的 76px「环 + 时分」推翻，回到**纯图形**：一枚秒表。
 *
 * 三层结构（对齐手机端 `.m-ring` 的语言，只换量纲）：
 *   1. 外环   —— 表盘细框 + 进度弧，**一分钟转一圈**（[V0.11.4] 用户口径）；
 *                弧的长度/状态复用 `MainButton.arcSpec`（ADR-024 四条规则：
 *                倒计时收缩 / 正计时 90° 短弧 / 暂停静弧 / 结束整周加粗）；
 *   2. 分针   —— 从圆心指向外缘的针，**一小时转一圈**（[V0.11.4]：像钟表的分针）；
 *   3. 轴心   —— 圆心一个小点收口，让两根针的交点有个落点。
 *
 * 为什么环不放数字：用户口径「环是图形语言，不应放时间，参考安卓端的图形化语言」。
 *
 * 转速口径（[V0.11.4] 改）：
 *   - 外环：CSS 动画 60s/圈；`data-turn` 只在计时中为 true，暂停时把动画**冻在当前位置**
 *     （`animation-play-state: paused`），不改回起点；
 *   - 分针：正计时 `displaySec % 3600`，一秒走 0.1°（分针本来就这么慢）；
 *     倒计时仍按「已用比例 × 360°」整圈走完——倒计时的「一圈」就是它的总时长，
 *     换成 3600s 口径反而读不出还剩多少；空闲 / 结束回 12 点。
 *
 * 读数去哪了：`title` 里仍是「时长 · 事项名」，悬停可看；圆点本身不再写字。
 * 交互不变：单击展开回悬浮条，右键只吞事件。
 */
import type { MouseEvent as ReactMouseEvent } from 'react';
import { COUNTDOWN_WARN_SEC } from '../../lib/constants';
import { formatDuration } from '../../lib/format';
import { arcDashArray, arcDashOffset, isArcVisible } from '../../lib/ringGeometry';
import { useEndedFlash } from '../../hooks/useEndedFlash';
import { usePillDrag } from '../../hooks/usePillDrag';
import { useTimerTick } from '../../hooks/useTimerTick';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useCountdownArmStore } from '../../stores/countdownArm';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { toVisualState } from '../../types/ui';
import { arcSpec } from '../pill/MainButton';

/* [V0.11.4] 22px：用户口径「缩小一倍」。所有几何量按原 44px 等比减半，
   再按「看得见轮廓」微调（描边不能跟着减半，否则 1x 屏上直接糊掉）。 */
const SIZE = 22;
const CENTER = SIZE / 2;
/** 表盘外框半径：留半个描边余量，避免被 viewBox 切掉 */
const RIM_RADIUS = 10.3;
const RIM_STROKE = 0.75;
/** 环（进度弧）半径：比表盘内收 2.7px，两层之间留出呼吸的空隙 */
const ARC_RADIUS = 7.6;
const ARC_STROKE = 1.8;
/** 分针：从圆心出发，长度约为环半径的 60%，根部一个小圆点收口 */
const NEEDLE_LEN = 4.6;
const NEEDLE_STROKE = 1.1;

export function CollapsedDot() {
  const seconds = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const sessionItemId = session?.itemId ?? null;
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const armedSec = useCountdownArmStore((s) => s.armedSec);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);
  /* [V0.11.2] 圆点也要能拖：收起后 PillBar 已卸载，这里是主窗唯一的抓手。
     复用与悬浮条同一套阈值（4px 才算拖、拖完吞掉那次 click），所以单击仍是展开。 */
  const drag = usePillDrag();

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

  /* 分针角度：正计时一小时一圈（一秒 0.1°）；倒计时按已用比例整圈；
     空闲 / 结束回 12 点。暂停时 useTimerTick 不再给新值，针自然冻住。 */
  const needleAngle = isCountdown
    ? (1 - progress) * 360
    : visual === 'idle' || visual === 'ended'
      ? 0
      : (displaySec % 3600) * 0.1;

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
      data-turn={visual === 'running' ? 'true' : 'false'}
      title={`${text} · ${name}`}
      aria-label={`收起状态：${text} · ${name}，单击展开，拖动可移动`}
      onPointerDown={drag.onDown}
      onPointerMove={drag.onMove}
      onPointerUp={drag.onUp}
      onPointerCancel={drag.onUp}
      onClickCapture={drag.onClickCapture}
      onClick={toggleCollapsed}
      onContextMenu={handleContextMenu}
    >
      <svg className="dot__svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        {/* 外环：表盘 + 进度弧一起转，一分钟一圈（CSS 动画，暂停冻在当前位置） */}
        <g className="dot__ring">
          <circle className="dot__rim" cx={CENTER} cy={CENTER} r={RIM_RADIUS} strokeWidth={RIM_STROKE} />
          {showBar && (
            <circle
              className="dot__arc"
              cx={CENTER}
              cy={CENTER}
              r={ARC_RADIUS}
              /* 结束整周加粗：与 MainButton / m-ring 同一个「加一点」的口径，按小尺寸折算 */
              strokeWidth={arc.thick ? ARC_STROKE + 0.4 : ARC_STROKE}
              pathLength={100}
              strokeDasharray={arcDashArray(arc.frac, arc.march)}
              strokeDashoffset={arc.march ? 0 : arcDashOffset(arc.frac)}
              /* 从 12 点起顺时针（与 TimerRing 同一条旋转口径） */
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            />
          )}
        </g>
        {/* 分针：一小时一圈，从 12 点起顺时针，角度由 needleAngle 给 */}
        <line
          className="dot__needle"
          x1={CENTER}
          y1={CENTER}
          x2={CENTER}
          y2={CENTER - NEEDLE_LEN}
          strokeWidth={NEEDLE_STROKE}
          strokeLinecap="round"
          transform={`rotate(${needleAngle} ${CENTER} ${CENTER})`}
        />
        <circle className="dot__pin" cx={CENTER} cy={CENTER} r={0.85} />
      </svg>
    </button>
  );
}
