/**
 * Timing — 收起圆点 CollapsedDot（V0.11.5 / [0.13.x] 黄点版）
 * -----------------------------------------------------------------------------
 * 用户口径：「环是图形语言，不应放时间，参考安卓端的图形化语言」。
 * 所以这一版仍是**纯图形**：不许在圈内写字。
 *
 * [0.13.x] 用户口径 2：「小圆点形态 UI 进行优化，内部分针过于具象化，优化为单个黄色
 * 圆点，圆点在圆指针顶部位置」。于是本轮**删掉分针与轴心**，只留一枚实心黄点：
 *   1. 外环   —— 一条**开口**进度弧，没有底环（**弧是用户认可的图形语言**）：
 *      · 正计时（running / paused）：弧拆成两端，**弧尾 = 黄点**（UI 图形起点），
 *        **弧头 = 当前秒的绝对位置**（0 点在顶部、一秒 6°）。弧从黄点顺时针铺到
 *        绝对秒位置，弧头不随黄点旋转；弧头追上黄点时归零（黄点自己也在走
 *        0.1°/s，所以一个视觉周期约 61s）。暂停时弧冻住，靠颜色区分暂停；
 *      · 倒计时 / 待命 / 结束 / 空闲：复用 `MainButton.arcSpec` 的比例，从
 *        12 点（0 点）起（倒计时按剩余比例收缩 / 待命与结束整环 / 空闲整环）；
 *      · [0.13.x] 用户口径 7：「环的断点处消失了，应保留；断点处蓝色为环做圆角」
 *        ——黄点处保留**可见断口**，遮罩挖出几何 82°，圆角端帽吃掉两端后可见约
 *        60°（黄点两侧各留 ~15° 空气）；断口两端是圆角，断口随分钟点绕圈。
 *      · [0.13.x] 用户口径 8：「黄点为 UI 图形起始；计时以 0 点为起始，计时走
 *        绝对位置，不随原点变化」——**两端分离**：
 *        · UI 图形起点（弧尾）= 黄点：蓝弧从黄点边缘起笔，环口随分钟点绕圈；
 *        · 计时（弧头）= 12 点（0 点）：一秒 6°，按绝对时钟位置推进，
 *          **不随黄点旋转**。
 *        黄点处的断口只负责图形从哪儿起笔，不改变弧头的计时相位。
 *      · 弧只由实色构成（没有「预览用」的半透明底环）。
 *   2. 黄点   —— **一枚**实心圆点，角度沿用原分针口径。
 *      [0.13.x] 用户口径 3：「黄色的分钟显示和圆结合，像图标一样」——黄点从环内的
 *      r=7 内轨搬到**环身上**（轨道半径 = 环半径）；环的开口（UI 图形起点）以黄点为界，
 *      计时 0 点仍在顶部 12 点，不随黄点移动。
 *   3. 小时档色 —— [0.13.x] 用户口径 9：取消中心小时点，改为**黄点本身按已计时
 *      小时换色**：<1h 黄（--color-warn）/ 1–2h 绿（--color-done）/
 *      ≥2h 紫（--color-violet）；中心保持纯空。档位仍按 4 小时封顶（data-hours
 *      1..4），2 档起并入紫色。
 *
 * 黄点取色：复用 `--color-warn`（= 设置里四色中的 `accents.warn`，出厂默认 `#E8A33D`；
 * 语义令牌 `--warn` 在深色主题即 #E8A33D、浅色主题为达标的 #A05E00）。
 * 为什么是它：用户要的是「黄色，参考默认设置颜色」——`ReferenceSettings` 里唯一的颜色是
 * `highlightColor`，出厂 `#4DA3E8` 是**蓝**，不是黄；全仓唯一的黄系既有定义就是
 * `DEFAULT_SETTINGS.accents.warn = '#E8A33D'`（`lib/theme.ts` 的 `DEFAULT_ACCENTS.warn`
 * 与之同源）。所以黄色直接吃这个已有令牌：用户改了自己的 warn 色，圆点跟着走，与
 * 「设置里的默认黄」永远同源。走 `--color-warn` 而不是写死 `#E8A33D`，也让浅色主题
 * 自动换到达标的那一档（组件 CSS 禁止裸 hex，见 design-tokens 消费规则 P0）。
 *
 * 小时档色 [0.13.x]：1–2h 复用 `--color-done`（绿），≥2h 用新增的 `--color-violet`
 * （深/浅主题各一档，和 warn / ok 一样落在主题令牌里）。**只跟已计时小时走**；
 * 不跟运行状态变色：状态色已经由外环的 `currentColor` 表达（running / paused / ended /
 * 倒计时尾声），黄点跟状态走会和环同色、丢掉「点在哪儿」。
 *
 * 尺寸：33px（V0.11.4 定到 22px 后用户反馈「太小」，V0.11.5 放大 1.5 倍）。
 * 几何量按 22 → 33 等比放大；描边**不**严格等比 —— 33px 下照 0.5 倍描边会糊成一团，
 * 按 1x 屏可辨识微调过（见下方常量注释）。
 *
 * 弧怎么长出来的：正计时的弧尾在黄点（`rotate(markAngle − 90)`），
 * 弧头在绝对秒位置 `(sec % 60) × 6°`，dash 长度 = 从弧尾顺时针到弧头的角度；
 * 黄点处的**断口**用遮罩挖出来，遮罩随黄点（分钟）慢走。
 * 没有 CSS 旋转动画：相位由 `transform` 表达，弧头按绝对位置由 dash 长度表达。
 * 其余状态弧尾固定在 12 点（`rotate(-90)`），长度 = `arcSpec.frac × 360°`。
 *
 * 转速口径：
 *   - 外环：正计时弧头 `displaySec % 60`，一秒 6°；弧尾跟黄点走 0.1°/s，
 *     所以视觉上从黄点铺到绝对秒位置，约 61s 完成一次「追上黄点 → 归零」；
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
import { useEffect, useId, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { COUNTDOWN_WARN_SEC, HIGHLIGHT_MS } from '../../lib/constants';
import { formatDuration } from '../../lib/format';
import { isArcVisible } from '../../lib/ringGeometry';
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
/** 环半径与环粗：黄点并入环身后，这一圈就是唯一主圆（对齐 APP 图标的开口环）。
 *  环粗 2.4 → 3.4：33px 下 2.4 的圆弧在 1x 屏上锯齿感明显，加粗一档后边缘过渡更连续。 */
const ARC_RADIUS = 11.4;
const ARC_STROKE = 3.4;
/**
 * 环口（UI 图形起点）：遮罩在黄点处挖掉一段。82° 是**几何**开口——遮罩描边 4.4，
 * 两端 round 端帽各沿路径吃掉 `(4.4 / 2) / 11.4 ≈ 11.1°`，可见断口仍是 ~60°
 * （黄点两侧各 ~15° 空气）。若把这里改小，端帽会把断口重新吃掉，看起来又变回闭合。
 */
export const RING_GAP_DEG = 82;
const RING_ARC_DEG = 360 - RING_GAP_DEG;
/** 遮罩的 dash（`pathLength=100`）：画环口以外的 278°，余下 82° 挖空 */
const RING_DASH = `${round6(RING_ARC_DEG / 3.6)} ${round6(RING_GAP_DEG / 3.6)}`;
/** 黄点轨道半径 = 环半径：点嵌在环口里（原先的 r=7 内轨退场） */
const MARK_ORBIT = ARC_RADIUS;
/**
 * 黄点半径 3：跟着环一起加粗（原 2.4 的 4.8px 圆点在 1x 屏上像素块明显）。
 * 直径 6px，在环上遮掉约 30.5°；可见断口约 60°，两侧各留 ~15° 空气，断口看得见。
 */
const MARK_RADIUS = 3.0;

/** 坐标保留 3 位小数：DOM 上不出现 16.500000000000004，逐帧位移 0.012px 也仍然可见 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** dash 长度保留 6 位：3 位会把 1/60 的比例舍到 1e-5，测试里钉死的秒数就失真了 */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
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
  /* [V0.11.5] 正计时（running / paused）的弧拆成两端：
     · **弧尾 = 黄点**（UI 图形起点，用户口径「黄点为 ui 图形起始」）；
     · **弧头 = 绝对秒位置**（0 点在顶部、一秒 6°，用户口径「计时走绝对位置」）。
     弧从黄点顺时针铺到当前秒的绝对位置；弧头不随黄点旋转。
     黄点处的断口由遮罩挖出，所以蓝弧的可见起点仍是黄点边缘。
     暂停没有 CSS 动画：`useTimerTick` 暂停后不再递新值，弧长自然冻住，
     颜色走 --color-warn 区分暂停。倒计时 / 待命 / 结束 / 空闲沿用 arcSpec 的静态弧。 */
  const growth = !isCountdown && (visual === 'running' || visual === 'paused');

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

  const thick = growth ? false : arc.thick;
  /* 倒计时剩最后 60s：环切红（与小条同一阈值，令牌 --color-danger） */
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;
  const text = formatDuration(displaySec);

  /* 遮罩的相位：环口中心 = 黄点角度（时钟角 θ），换算到 SVG 角再让环口中心
     落在 dash 的缺口正中：θ−90 + 82/2 = θ−49。**UI 图形起点随黄点绕圈**。 */
  const maskRotate = round3(markAngle - 90 + RING_GAP_DEG / 2);
  /* 弧尾：正计时 = 黄点；其余状态 = 12 点（计时 0 点）。
     弧头：正计时 = 绝对秒位置 `(sec % 60) × 6°`；其余 = arcSpec 的比例。
     delta = 从弧尾顺时针到弧头的角度（`pathLength=100` 口径 = delta / 3.6）。
     正计时里 delta 随秒增长，弧头追上黄点时归零；黄点自己也在走 0.1°/s，
     所以一个视觉周期约 61s，但弧头始终落在绝对秒位置上，不被黄点带走。 */
  const headAngle = (smoothDisplay % 60) * 6;
  const arcTail = growth ? markAngle : 0;
  const arcHead = growth ? headAngle : arc.frac * 360;
  const arcDelta = growth ? (arcHead - arcTail + 360) % 360 : arcHead;
  const arcUnits = arcDelta / 3.6;
  const arcRotate = round3(arcTail - 90);
  /* 弧头追上弧尾（delta=0）时不画 bar：round linecap 会留下一个直径 = 描边宽的亮点 */
  const showBar = isArcVisible(arcDelta / 360);
  /* 遮罩 id 必须唯一：同页可能同时存在多个圆点（临时展开的过渡态）。
     React 18 的 useId 是 `:r0:`、19 是 `«r0»`：只留字母数字，避免 `url(#...)` 里出现怪字符 */
  const maskId = `dot-gap-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  /* 小时档位：按**已计时**小时分档（正计时 / 倒计时同一口径），4 小时封顶。
     颜色由 CSS 按 data-hours 映射到黄点：0 黄 / 1 绿 / 2..4 紫；圆心不再画点。 */
  const hourTier = Math.min(4, Math.floor(seconds / 3600));

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
      /* 小时档位：0 = 不足 1 小时（不画中心点）；1..4 由 CSS 换色 */
      data-hours={hourTier}
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
        {/* 遮罩：在黄点处挖出 UI 图形起点（环口）。描边白色 = 露环，缺口 = 挖空；
            遮罩随黄点旋转，所以「环从哪儿开口」跟着分钟点走。 */}
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <circle
              className="dot__mask"
              cx={CENTER}
              cy={CENTER}
              r={ARC_RADIUS}
              fill="none"
              stroke="#fff"
              /* 比环粗 1：round 端帽沿路径多吃一截，可见断口收在 ~60° */
              strokeWidth={ARC_STROKE + 1}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={RING_DASH}
              transform={`rotate(${maskRotate} ${CENTER} ${CENTER})`}
            />
          </mask>
        </defs>
        {/* 环就是进度弧本身（实色，无底环预览）：正计时从黄点顺时针铺到绝对秒位置
            （0 点在顶部），其余状态从 12 点铺开；黄点处的断口由上面的遮罩挖出。
            可见段两端走 round 端帽——这就是「断点处蓝色环做圆角」。 */}
        <g mask={`url(#${maskId})`}>
          {showBar && (
            <circle
              className="dot__arc"
              cx={CENTER}
              cy={CENTER}
              r={ARC_RADIUS}
              /* 结束整环加粗：与 MainButton / m-ring 同一个「加一点」的口径，按小尺寸折算 */
              strokeWidth={thick ? ARC_STROKE + 0.5 : ARC_STROKE}
              pathLength={100}
              /* 可见段 + 余量：pattern 总长恒为 100，永远只画一段连续的弧 */
              strokeDasharray={`${round6(arcUnits)} ${round6(100 - arcUnits)}`}
              transform={`rotate(${arcRotate} ${CENTER} ${CENTER})`}
            />
          )}
        </g>
        {/* 黄点：嵌在环的缺口里（轨道半径 = 环半径），角度由 markAngle 给（0° = 12 点）；
            颜色按已计时小时由 CSS 的 data-hours 规则切换，圆心不再画小时点 */}
        <circle className="dot__mark" cx={markCx} cy={markCy} r={MARK_RADIUS} />
      </svg>
    </button>
  );
}
