/**
 * Timing — 收起圆点 CollapsedDot（V0.11.1 秒表形态）
 * -----------------------------------------------------------------------------
 * 用户口径（2026-11-05）：「环是图形语言，不应放时间，参考安卓端的图形化语言」。
 * 所以这一版把上一版的 76px「环 + 时分」推翻，回到**纯图形**：一枚秒表。
 *
 * 三层结构（对齐手机端 `.m-ring` 的语言，只换量纲）：
 *   1. 外框   —— 1px 细环，恒在，是「表盘」，不表达状态（图上它是浅灰的）；
 *   2. 进度弧 —— 3.5px 圆头弧，长度/行进复用 `MainButton.arcSpec`（ADR-024 四条规则：
 *                倒计时收缩 / 正计时 90° 短弧行进 / 暂停 270° 静弧 / 结束整周加粗）；
 *   3. 指针   —— 一根从圆心指向外缘的针，60 秒一圈，替掉数字去表达「在走」。
 *
 * 指针角度口径：
 *   - 正计时 / 空闲：`seconds % 60`，一秒 6°，像秒表；
 *   - 倒计时：已用比例 × 360°（环在收缩、针在前进，两者同向才读得懂）；
 *   - 空闲 / 结束：回 12 点。
 * 暂停时 `useTimerTick` 不再给新值，指针自然冻住——不需要额外的暂停分支。
 *
 * 读数去哪了：`title` 里仍是「时长 · 事项名」，悬停可看；圆点本身不再写字。
 * 交互不变：单击展开回悬浮条，右键只吞事件。
 */
import type { MouseEvent as ReactMouseEvent } from 'react';
import { COUNTDOWN_WARN_SEC } from '../../lib/constants';
import { formatDuration } from '../../lib/format';
import { arcDashArray, arcDashOffset, isArcVisible } from '../../lib/ringGeometry';
import { useEndedFlash } from '../../hooks/useEndedFlash';
import { useTimerTick } from '../../hooks/useTimerTick';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useCountdownArmStore } from '../../stores/countdownArm';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { toVisualState } from '../../types/ui';
import { arcSpec } from '../pill/MainButton';

/* 44px 是「看得清指针、又不占桌面」的折中：再小圆头弧会糊，再大就快赶上小条了 */
const SIZE = 44;
const CENTER = SIZE / 2;
/** 表盘外框半径：留 1px 描边余量，避免被 viewBox 切掉半个像素 */
const RIM_RADIUS = 21;
const RIM_STROKE = 1.25;
/** 进度弧半径：比表盘内收 5.5px，两层之间留出呼吸的空隙（同图） */
const ARC_RADIUS = 15.5;
const ARC_STROKE = 3.5;
/** 指针：从圆心出发，长度约为弧半径的 55%，根部一个小圆点收口 */
const NEEDLE_LEN = 8.5;
const NEEDLE_STROKE = 2.2;

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

  /* 指针角度：倒计时按已用比例走，其余按 60 秒一圈（空闲 / 结束回 12 点） */
  const needleAngle = isCountdown
    ? (1 - progress) * 360
    : visual === 'idle' || visual === 'ended'
      ? 0
      : (displaySec % 60) * 6;

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
      title={`${text} · ${name}`}
      aria-label={`收起状态：${text} · ${name}，单击展开`}
      onClick={toggleCollapsed}
      onContextMenu={handleContextMenu}
    >
      <svg className="dot__svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        {/* 表盘：恒在，不随状态变色（状态一律由内圈与指针表达） */}
        <circle className="dot__rim" cx={CENTER} cy={CENTER} r={RIM_RADIUS} strokeWidth={RIM_STROKE} />
        {showBar && (
          <circle
            className="dot__arc"
            cx={CENTER}
            cy={CENTER}
            r={ARC_RADIUS}
            /* 结束整周加粗：与 MainButton / m-ring 同一个「加一点」的口径，按小尺寸折算 */
            strokeWidth={arc.thick ? ARC_STROKE + 0.8 : ARC_STROKE}
            pathLength={100}
            strokeDasharray={arcDashArray(arc.frac, arc.march)}
            strokeDashoffset={arc.march ? 0 : arcDashOffset(arc.frac)}
            /* 从 12 点起顺时针（与 TimerRing 同一条旋转口径） */
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        )}
        {/* 指针：从 12 点起顺时针转，角度由上面的 needleAngle 给 */}
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
        <circle className="dot__pin" cx={CENTER} cy={CENTER} r={1.6} />
      </svg>
    </button>
  );
}
