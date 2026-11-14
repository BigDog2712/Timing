/**
 * Timing — 收起圆点 CollapsedDot（V0.11.5 / [0.13.x] 黄点版）
 * -----------------------------------------------------------------------------
 * 用户口径：「环是图形语言，不应放时间，参考安卓端的图形化语言」。
 * 所以这一版仍是**纯图形**：不许在圈内写字。
 *
 * [0.13.x] 用户口径 2：「小圆点形态 UI 进行优化，内部分针过于具象化，优化为单个黄色
 * 圆点，圆点在圆指针顶部位置」。于是本轮**删掉分针与轴心**，只留一枚实心黄点：
 *   1. 外环   —— 表盘细框 + 进度弧（**原样保留**：弧是用户认可的图形语言）：
 *      · 正计时（running / paused）：弧**从 12 点起点随时间增长**，60 秒长满一圈后
 *        从头再来；暂停时弧冻在当前长度上，靠颜色区分暂停（[V0.11.5] 用户口径）；
 *      · 倒计时 / 待命 / 结束 / 空闲：复用 `MainButton.arcSpec`（ADR-024 四条规则：
 *        倒计时按剩余比例收缩 / 待命与结束整周 / 空闲整周细弧）；
 *   2. 黄点   —— **一枚**实心圆点，位置 = 原分针的**针尖端**（轨道半径仍是原针长 7），
 *      角度沿用原分针口径。原来那条「从圆心伸到外缘的针 + 圆心轴心」就是用户说的
 *      「过于具象」，本轮只留针尖那一点：既保住了「转速」这个信息，又不再画钟表指针。
 *
 * 黄点取色：复用 `--color-warn`（= 设置里四色中的 `accents.warn`，出厂默认 `#E8A33D`；
 * 语义令牌 `--warn` 在深色主题即 #E8A33D、浅色主题为达标的 #A05E00）。
 * 为什么是它：用户要的是「黄色，参考默认设置颜色」——`ReferenceSettings` 里唯一的颜色是
 * `highlightColor`，出厂 `#4DA3E8` 是**蓝**，不是黄；全仓唯一的黄系既有定义就是
 * `DEFAULT_SETTINGS.accents.warn = '#E8A33D'`（`lib/theme.ts` 的 `DEFAULT_ACCENTS.warn`
 * 与之同源）。所以这里**不新造色值**，直接吃这个已有令牌：用户改了自己的 warn 色，圆点
 * 跟着走，与「设置里的默认黄」永远同源。走 `--color-warn` 而不是写死 `#E8A33D`，
 * 也让浅色主题自动换到达标的那一档（组件 CSS 禁止裸 hex，见 design-tokens 消费规则 P0）。
 *
 * 黄点**不跟状态变色**：状态色已经由外环的 `currentColor` 表达（running / paused / ended /
 * 倒计时尾声），黄点是「针尖」这个几何标记本身，跟状态走会和环同色、丢掉「点在哪儿」。
 *
 * 尺寸：33px（V0.11.4 定到 22px 后用户反馈「太小」，V0.11.5 放大 1.5 倍）。
 * 几何量按 22 → 33 等比放大；描边**不**严格等比 —— 33px 下照 0.5 倍描边会糊成一团，
 * 按 1x 屏可辨识微调过（见下方常量注释）。
 *
 * 弧怎么长出来的：`stroke-dasharray` 整段 + `stroke-dashoffset` 表达「已画出多少」，
 * 于是弧**从起点生长**，而不是固定长度地沿着轨道绕圈；圆点里没有任何 `transform`
 * 动画，整组 `<g>` 也不旋转。
 *
 * 转速口径（黄点沿用原分针，一字未改）：
 *   - 外环：正计时 `displaySec % 60`，一秒 1/60 圈（= 6°），60 秒长满；
 *   - 黄点：正计时 `displaySec % 3600`，一秒 0.1°（分针本来就这么慢）；
 *     倒计时仍按「已用比例 × 360°」整圈走完——倒计时的「一圈」就是它的总时长，
 *     换成 3600s 口径反而读不出还剩多少；空闲 / 结束回 12 点。
 *
 * 读数去哪了：`title` 里仍是「时长 · 事项名」，悬停可看；圆点本身不再写字。
 * 交互不变：单击展开回悬浮条，右键只吞事件。
 * [V0.11.5] 托盘双击 → 高亮：圆点形态下 PillBar 已卸载，所以这里自己订阅
 *   `highlightSeq` 并挂 `data-highlight`（样式见 `styles/dot.css`）。
 * [0.13.x] 形态临时展开（点托盘图标 → 圆点临时变条再收回）由 `entry/App.tsx` 的
 *   `useTempExpandOnHighlight` 统一处理，本组件不参与——它只负责「闪」。
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
/** 黄点轨道半径 = 原分针长度（7）：「圆点在原分针顶端位置」，位置口径原样接过 */
const MARK_ORBIT = 7;
/**
 * 黄点半径 2.4：取进度弧的描边宽（同一档视觉重量）。
 * 原针描边 1.5 是「画一条线」的量纲，直径 3px 的点在 33px 里几乎看不见；2.4 直径 4.8px，
 * 与环的粗细对齐、又不至于把环内的空白吃掉（点在 4.6..9.4，弧在 10.2..12.6，留 0.8px 空隙）。
 */
const MARK_RADIUS = 2.4;

/** 坐标保留 3 位小数：DOM 上不出现 16.500000000000004，逐帧位移 0.012px 也仍然可见 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function CollapsedDot() {
  /* [V0.11.10] 弧与黄点改吃「带小数的秒」，逐帧推进。
     原来一秒一跳：弧每次跳 6°（33px 下约 1.2px），看着是顿的；点更狠，一分钟才挪一格。
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

  /* 同一口径的小数版：只给弧和黄点用 */
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

  /* 黄点角度（= 原分针角度，一字未改）：正计时一小时一圈（一秒 0.1°）；倒计时按已用比例
     整圈；空闲 / 结束回 12 点。v0.11.10 起吃小数秒，点是匀速扫过去的，不是每分钟挪一格。 */
  const markAngle = isCountdown
    ? (1 - progress) * 360
    : visual === 'idle' || visual === 'ended'
      ? 0
      : (smoothDisplay % 3600) * 0.1;

  /* 角度 → 圆周坐标：0° 在 12 点、顺时针。直接用 cx/cy 而不是给 `transform=rotate(...)`，
     一是少一层变换、二是「点在圆周的哪儿」在 DOM 上就能读到（测试也钉在这里）。 */
  const markRad = ((markAngle - 90) * Math.PI) / 180;
  const markCx = round3(CENTER + MARK_ORBIT * Math.cos(markRad));
  const markCy = round3(CENTER + MARK_ORBIT * Math.sin(markRad));

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
        {/* 外环：表盘细框 + 进度弧（弧长随秒数增长，不做整体旋转）。用户认可这段图形语言，本轮不动 */}
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
        {/* 黄点：原分针的针尖端，角度由 markAngle 给（0° = 12 点，顺时针） */}
        <circle className="dot__mark" cx={markCx} cy={markCy} r={MARK_RADIUS} />
      </svg>
    </button>
  );
}
