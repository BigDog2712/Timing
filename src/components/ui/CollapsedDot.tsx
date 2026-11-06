/**
 * Timing — 收起圆点 CollapsedDot（V0.11.5）
 * -----------------------------------------------------------------------------
 * 用户口径：「环是图形语言，不应放时间，参考安卓端的图形化语言」。
 * 所以这一版仍是**纯图形**：一枚秒表（外环 + 分针 + 轴心），圈内不写字。
 *
 * 三层结构（对齐手机端 `.m-ring` 的语言，只换量纲）：
 *   1. 外环   —— 表盘细框 + 进度弧：
 *      · 正计时（running / paused）：弧**从 12 点起点随时间增长**，60 秒长满一圈后
 *        从头再来；暂停时弧冻在当前长度上，靠颜色区分暂停（[V0.11.5] 用户口径）；
 *      · 倒计时 / 待命 / 结束 / 空闲：复用 `MainButton.arcSpec`（ADR-024 四条规则：
 *        倒计时按剩余比例收缩 / 待命与结束整周 / 空闲整周细弧）；
 *   2. 分针   —— 从圆心指向外缘的针，**一小时转一圈**（像钟表的分针）；
 *   3. 轴心   —— 圆心一个小点收口，让两根针的交点有个落点。
 *
 * 尺寸：33px（V0.11.4 定到 22px 后用户反馈「太小」，本轮放大 1.5 倍）。
 * 几何量按 22 → 33 等比放大；描边**不**严格等比 —— 33px 下照 0.5 倍描边会糊成一团，
 * 按 1x 屏可辨识微调过（见下方常量注释）。
 *
 * 弧怎么长出来的：`stroke-dasharray` 整段 + `stroke-dashoffset` 表达「已画出多少」，
 * 于是弧**从起点生长**，而不是固定长度地沿着轨道绕圈；圆点里没有任何 `transform`
 * 动画，整组 `<g>` 也不旋转。
 *
 * 转速口径：
 *   - 外环：正计时 `displaySec % 60`，一秒 1/60 圈（= 6°），60 秒长满；
 *   - 分针：正计时 `displaySec % 3600`，一秒走 0.1°（分针本来就这么慢）；
 *     倒计时仍按「已用比例 × 360°」整圈走完——倒计时的「一圈」就是它的总时长，
 *     换成 3600s 口径反而读不出还剩多少；空闲 / 结束回 12 点。
 *
 * 读数去哪了：`title` 里仍是「时长 · 事项名」，悬停可看；圆点本身不再写字。
 * 交互不变：单击展开回悬浮条，右键只吞事件。
 * [V0.11.5] 托盘双击 → 高亮：圆点形态下 PillBar 已卸载，所以这里自己订阅
 *   `highlightSeq` 并挂 `data-highlight`（样式见 `styles/highlight.css` 同源的 dot.css）。
 */
import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { COUNTDOWN_WARN_SEC, HIGHLIGHT_MS } from '../../lib/constants';
import { formatDuration } from '../../lib/format';
import { arcDashArray, arcDashOffset, isArcVisible } from '../../lib/ringGeometry';
import { useEndedFlash } from '../../hooks/useEndedFlash';
import { usePillDrag } from '../../hooks/usePillDrag';
import { useSmoothTimerTick } from '../../hooks/useTimerTick';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useCountdownArmStore } from '../../stores/countdownArm';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { toVisualState } from '../../types/ui';
import { arcSpec } from '../pill/MainButton';

/* [V0.11.5] 33px：V0.11.4 的 22px 放大 1.5 倍（用户口径「太小」）。几何量按 1.5 倍
   等比放大，描边单独微调（等比会得到 1.125 / 2.7 / 1.65，33px 下细描边在 1x 屏糊掉）。 */
const SIZE = 33;
const CENTER = SIZE / 2;
/** 表盘外框半径：留半个描边余量，避免被 viewBox 切掉 */
const RIM_RADIUS = 15.45;
const RIM_STROKE = 1.1;
/** 环（进度弧）半径：比表盘内收 4.05px，两层之间留出呼吸的空隙 */
const ARC_RADIUS = 11.4;
const ARC_STROKE = 2.4;
/** 分针：从圆心出发，长度约为环半径的 61%，根部一个小圆点收口 */
const NEEDLE_LEN = 7;
const NEEDLE_STROKE = 1.5;
/** 轴心（圆心小点）半径 */
const PIN_RADIUS = 1.2;

export function CollapsedDot() {
  /* [V0.11.10] 弧与分针改吃「带小数的秒」，逐帧推进。
     原来一秒一跳：弧每次跳 6°（33px 下约 1.2px），看着是顿的；分针更狠，一分钟才挪一格。
     文本仍用取整后的秒，读数不会出现 04:59.7 这种中间态。 */
  const smoothSec = useSmoothTimerTick();
  const seconds = Math.floor(smoothSec);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const sessionItemId = session?.itemId ?? null;
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const items = useItemStore((s) => s.items);
  const armedSec = useCountdownArmStore((s) => s.armedSec);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);
  /* [V0.11.5] 托盘双击 → 高亮定位。与 PillBar 同一套口径（序号变化即闪 3 下），
     圆点形态下 PillBar 不渲染，所以这里必须自己订阅，否则永远不闪。 */
  const highlightSeq = useUiStore((s) => s.highlightSeq);
  /* [V0.11.2] 圆点也要能拖：收起后 PillBar 已卸载，这里是主窗唯一的抓手。
     复用与悬浮条同一套阈值（4px 才算拖、拖完吞掉那次 click），所以单击仍是展开。 */
  const drag = usePillDrag();

  /* 结束态 900ms（与药丸同源）：窗口判定在 hook 里，折叠→展开不会重放旧时间戳 */
  const ended = useEndedFlash();

  /* [V0.11.5] 高亮闪烁：`highlightSeq` 从 0 起步——初始挂载不该闪，所以只在 > 0 时触发 */
  const [highlighting, setHighlighting] = useState(false);
  useEffect(() => {
    if (highlightSeq <= 0) return;
    setHighlighting(true);
    const id = window.setTimeout(() => setHighlighting(false), HIGHLIGHT_MS);
    return () => window.clearTimeout(id);
  }, [highlightSeq]);

  const visual = toVisualState(status, ended);
  const currentItemId = status === 'idle' ? lastItemId : sessionItemId;
  const name = findItem(items, currentItemId)?.name ?? '未归类';

  /* 与 PillBar 同一套读数口径：倒计时显示剩余、空闲但已定时长显示该时长、否则正计时秒数 */
  const isCountdown = session?.mode === 'countdown' && session.targetSec != null;
  const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - seconds) : 0;
  const armedIdle = status === 'idle' && armedSec != null;
  const displaySec = isCountdown ? remaining : armedIdle ? (armedSec ?? 0) : seconds;

  /* 同一口径的小数版：只给弧和分针用 */
  const smoothRemaining = isCountdown ? Math.max(0, (session?.targetSec ?? 0) - smoothSec) : 0;
  const smoothDisplay = isCountdown ? smoothRemaining : armedIdle ? (armedSec ?? 0) : smoothSec;

  const progress = isCountdown && session?.targetSec ? smoothRemaining / session.targetSec : 1;
  const arc = arcSpec(visual, isCountdown || armedIdle, progress);
  /* [V0.11.5] 正计时（running / paused）改「增长弧」：从 12 点起随时间延伸，
     60 秒长满一圈后回到起点重来（用户口径：「不应该长度固定地绕圈」）。
     暂停不在 CSS 里冻动画（已经没有动画了）：`useTimerTick` 暂停后不再递新值，
     `displaySec` 停住 → 弧长自然冻在当前长度，颜色走 --color-warn 区分暂停。
     倒计时 / 待命 / 结束 / 空闲沿用 arcSpec 的静态弧，口径不变。 */
  const growth = !isCountdown && (visual === 'running' || visual === 'paused');
  const frac = growth ? (smoothDisplay % 60) / 60 : arc.frac;
  const march = growth ? false : arc.march;
  const thick = growth ? false : arc.thick;
  /* 倒计时剩最后 60s：环切红（与小条同一阈值，令牌 --color-danger） */
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;
  /* frac 归零时不画 bar：round linecap 会留下一个直径 = 描边宽的亮点（同 MainButton / TimerRing） */
  const showBar = isArcVisible(frac);
  const text = formatDuration(displaySec);

  /* 分针角度：正计时一小时一圈（一秒 0.1°）；倒计时按已用比例整圈；
     空闲 / 结束回 12 点。v0.11.10 起吃小数秒，针是匀速扫过去的，不是每分钟挪一格。 */
  const needleAngle = isCountdown
    ? (1 - progress) * 360
    : visual === 'idle' || visual === 'ended'
      ? 0
      : (smoothDisplay % 3600) * 0.1;

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
      data-highlight={highlighting ? 'true' : 'false'}
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
        {/* 外环：表盘细框 + 进度弧（弧长随秒数增长，不做整体旋转） */}
        <g>
          <circle className="dot__rim" cx={CENTER} cy={CENTER} r={RIM_RADIUS} strokeWidth={RIM_STROKE} />
          {showBar && (
            <circle
              className="dot__arc"
              cx={CENTER}
              cy={CENTER}
              r={ARC_RADIUS}
              /* 结束整周加粗：与 MainButton / m-ring 同一个「加一点」的口径，按小尺寸折算 */
              strokeWidth={thick ? ARC_STROKE + 0.5 : ARC_STROKE}
              pathLength={100}
              strokeDasharray={arcDashArray(frac, march)}
              strokeDashoffset={march ? 0 : arcDashOffset(frac)}
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
        <circle className="dot__pin" cx={CENTER} cy={CENTER} r={PIN_RADIUS} />
      </svg>
    </button>
  );
}
