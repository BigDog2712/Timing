/**
 * TickBar — 状态环按钮 RingButton（药丸左侧核心）
 * -----------------------------------------------------------------------------
 * 规格：环 16×16（--ring-size）、描边 2.4（--ring-stroke），形态是**超椭圆**（squircle），
 *   不是圆也不是圆角矩形——四边近乎平直、角部曲率连续，见 `lib/ringGeometry.ts`
 *   的 `ARC_PATH`（n=3，小米 logo 量级）。几何由 `ringGeometry.test.ts` 逐点代回方程验算。
 *   命中区经 `.ring::before` 外扩 4px（实际 24×24，因为 V0.3.7 起 `.ring` 不再有 border）。
 *   状态由「环色 + 弧形」承载——**环内不放图标**：图标锁 16/20/24 档，16 的环不容。
 *
 * [V0.3.7] **全状态单一载体**：从 idle / running / paused / ended 到倒计时的每一种形态，
 *   都渲染同一个 `<svg>` + 同一条 `ARC_PATH`，`border` 彻底退场（只留 `border: 0` 占位）。
 *   这么改的直接动因是形状：idle / ended 原来走 CSS `border-radius`，那是圆角矩形，
 *   与 SVG 的超椭圆是两种形状；空环恰恰是用户最常看到的状态（空闲待命），
 *   只改计时态等于没改。附带收益：
 *   ① 环的粗细只剩一个来源（SVG 2.44px），不再有 `border-width: 2.4` 被 Chromium
 *      吸附成 2.00px 的 18% 偏差（ADR-024 的 F2 遗留）；
 *   ② `.ring::before` 的 `inset` 相对 padding box，去掉 border 后 padding box = 16，
 *      命中区终于真的等于注释里写了很久的 24×24（原先是 19.2×19.2）。
 *
 * [V0.3.6] 弧语义统一（裁决见 docs/decisions/ADR-024.md）。三条硬规则：
 *   1) **单一结构**：一律「SVG track + SVG bar」；底环透明度只有 37% 一处
 *      （.ring__arc-track），不再有 border 版 35% 那第二套载体。
 *   2) **弧长语义统一**（顶边中点起顺时针）：
 *      - 倒计时 running：弧 = 剩余比例，**只收缩、不行进**；
 *      - 正计时 running：90° 短弧**沿轨道行进**（3.2s/圈，对齐 Timing），必须带 track；
 *      - paused（正计时 / 倒计时**同一种语言**）：270° 静弧 + warn 色 + track，不行进；
 *      - idle + 待命（armedIdle）：全周弧 + 全周 track，颜色走 running 系（表达「就绪」），静态；
 *      - idle 未待命：全周弧、无轨（等价于原来的细 border 环）；
 *      - ended：全周弧 + 描边加粗到 3px，颜色 --color-done（900ms 瞬时确认）。
 *   3) **「行进」= `stroke-dashoffset` 沿路径推进，**不是** `transform: rotate()`**（V0.3.6 P0）：
 *      squircle 只有 **90° 旋转对称**。把 rotate() 加在整个 `<svg>` 上会带来两个静默回归：
 *      ① **底轨一起歪掉**——环转到 41° 时四条边既不水平也不垂直，视觉上就是个歪框；
 *      ② **弧出轨**——90° 的弧段只在 90° 整数倍上与轨道曲率吻合，转到中途会浮在轨道内外。
 *      改用 `stroke-dasharray: "25 75"` + 动画推进 dashoffset（ring-march），弧永远贴着真实
 *      路径走、track 完全不动；动画落在 **bar** 上，`.ring__arc` 没有任何 transform。
 *   是否行进**显式**落在 `data-spin` 上（属性名沿用历史命名，语义是「弧沿轨道自行推进」，
 *   与 CSS transform 无关），不靠 `[data-state="running"]` 隐式命中：倒计时运行时
 *   `data-state` 同样是 running，隐式命中会让递减弧也动起来，用户读不出剩余量（D1）。
 *
 * [V0.3.6] 归零不残留圆点：`stroke-linecap: round` 下零长度 dash 仍会画出直径 2.4 的圆点，
 *   所以 `frac <= ARC_MIN_FRAC` 时**不渲染 bar**（track 保留，环仍是完整底轨）——
 *   见 `isArcVisible()` 的注释。
 *
 * 键盘：Space 开始/暂停、Enter 结束（在 PillBar 容器统一处理）。
 */
import type { VisualState } from '../../types/ui';
import { useRef } from 'react';
import { clientToLayer } from '../../lib/fitBounds';
import {
  ARC_PATH,
  ARC_PATH_LENGTH,
  arcDashArray,
  arcDashOffset,
  clampFrac,
  isArcVisible,
} from '../../lib/ringGeometry';

/** 正计时进行中的弧长 = 90°（0.25 圈；沿轨道行进的短弧，转速对齐 Timing） */
export const ARC_RUNNING_FRAC = 0.25;
/** 暂停态弧长 = 270°（0.75 圈；Timing RingPause）——正计时与倒计时共用同一套语言 */
export const ARC_PAUSED_FRAC = 0.75;

/**
 * 弧配置。
 * - `frac`  ：可见弧比例（1 = 整周，0 = 不可见）
 * - `track` ：是否渲染 SVG 底轨（37% 同色）。只有「正在量进度」与「待命」需要底轨；
 *             idle 未待命 / ended 只要一条弧，否则会多出一圈不必要的暗色描边。
 * - `march` ：是否**沿轨道行进**（正计时 running 独占）。行进由 dashoffset 动画实现，
 *             不涉及任何 transform；落到 DOM 的 `data-spin` 属性上（历史属性名）。
 * - `thick` ：描边是否加粗到 3px（ended 的瞬时确认）。落到 `data-thick`。
 */
export interface ArcSpec {
  frac: number;
  track: boolean;
  march: boolean;
  thick: boolean;
}

/**
 * 依「视觉状态 + 是否倒计时 + 剩余比例」决定弧形态。
 * V0.3.7 起**恒有返回值**：每一种状态都走同一条 SVG 路径，不再有「回落 border」的分支。
 */
export function arcSpec(
  state: VisualState,
  countdown: boolean,
  progress: number,
): ArcSpec {
  // 结束确认：整周 + 加粗，颜色由 [data-state="ended"] 的 color 承载
  if (state === 'ended') return { frac: 1, track: false, march: false, thick: true };
  // 暂停优先：两模式统一 270° 静弧（Timing RingPause 暖橙），倒计时暂停也不再冻结进度弧
  if (state === 'paused') {
    return { frac: ARC_PAUSED_FRAC, track: true, march: false, thick: false };
  }
  if (state === 'running') {
    // 倒计时：弧长 = 剩余量，只收缩不行进；正计时：90° 弧沿轨道行进表达「进行中」
    return countdown
      ? { frac: clampFrac(progress), track: true, march: false, thick: false }
      : { frac: ARC_RUNNING_FRAC, track: true, march: true, thick: false };
  }
  // idle：待命（已选好时长）→ 整周弧 + 整周轨表达「就绪」；未待命 → 整周细弧、无轨
  return { frac: 1, track: countdown, march: false, thick: false };
}

interface MainButtonProps {
  state: VisualState;
  label: string;
  onClick: () => void;
  /** [V0.2.0] 倒计时模式：色环显示递减弧（armedIdle 亦为 true，表示「已选好时长待命」） */
  countdown?: boolean;
  /** [V0.2.0] 剩余比例（0..1，= remaining / targetSec） */
  progress?: number;
  /** [V0.2.0] 接近到点（剩余 ≤ 阈值）→ 弧与轨道切红并闪烁 */
  warn?: boolean;
  /**
   * [V0.2.6] 右键（对齐 Timing v1.7.3 的 Zone.Ring / OnRingRight）：
   * 计时中 = 结束并保存；空闲 = 主菜单。按下/抬起都不往上传，避免再被 PillBar 的空白区逻辑接管。
   */
  onMenu?: (pos: { x: number; y: number }) => void;
}

export function MainButton({
  state,
  label,
  onClick,
  countdown = false,
  progress = 1,
  warn = false,
  onMenu,
}: MainButtonProps) {
  const arc = arcSpec(state, countdown, progress);
  // frac 归零（含极小残值）时不画 bar：round linecap 会在环上留一个 2.4 直径的亮点
  const showBar = isArcVisible(arc.frac);
  const rightUpAt = useRef(0);

  return (
    <button
      type="button"
      className="ring"
      data-state={state}
      /* data-countdown 保留为语义 / 调试标记；CSS 只把它当「待命配色」的开关 */
      data-countdown={countdown ? 'true' : 'false'}
      data-warn={warn ? 'true' : 'false'}
      /* data-spin：弧是否沿轨道行进（历史命名，与 transform 无关）；CSS 只认 [data-spin="true"] */
      data-spin={arc.march ? 'true' : 'false'}
      /* data-thick：描边加粗（ended 的瞬时确认） */
      data-thick={arc.thick ? 'true' : 'false'}
      onClick={onClick}
      onPointerDown={onMenu ? (e) => { if (e.button === 2) e.stopPropagation(); } : undefined}
      onPointerUp={
        onMenu
          ? (e) => {
              if (e.button !== 2) return;
              e.stopPropagation();
              e.preventDefault();
              rightUpAt.current = Date.now();
              onMenu(clientToLayer(e.clientX, e.clientY));
            }
          : undefined
      }
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (Date.now() - rightUpAt.current < 400) return;
              onMenu(clientToLayer(e.clientX, e.clientY));
            }
          : undefined
      }
      aria-label={onMenu ? `${label}（右键结束或菜单）` : label}
    >
      <svg className="ring__arc" viewBox="0 0 16 16" aria-hidden>
        {arc.track && <path className="ring__arc-track" d={ARC_PATH} />}
        {showBar && (
          <path
            className="ring__arc-bar"
            d={ARC_PATH}
            pathLength={ARC_PATH_LENGTH}
            /* 行进（正计时）用「25 75」的短 dash，由 CSS 动画把 dashoffset 从 0 推到 −100
               沿路径顺时针走一圈；其余状态用整段 dash（「100」）+ 静态 dashoffset 表达弧长。
               两套口径由 arcSpec.march 显式区分，CSS 不猜。 */
            strokeDasharray={arcDashArray(arc.frac, arc.march)}
            /* 行进态的静态值取 0：reduced-motion 下动画关掉后，弧停在「顶部起 90°」这一帧 */
            strokeDashoffset={arc.march ? 0 : arcDashOffset(arc.frac)}
          />
        )}
      </svg>
    </button>
  );
}
