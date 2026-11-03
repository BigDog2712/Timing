/**
 * TickBar — 移动端大计时环（状态色 + 进度弧 + MM:SS）
 * -----------------------------------------------------------------------------
 * 弧语义**直接复用** `MainButton.arcSpec`（V0.3.6 / ADR-024 裁决过的四条规则）：
 * 倒计时只收缩、正计时 90° 短弧行进、暂停 270° 静弧、结束整周加粗。
 * 手机不需要另立一套语言——桌面用户和手机用户看到的是同一个「环在说什么」。
 *
 * 几何差别只有尺寸：小条是 16px 超椭圆环，这里是 232px 正圆环。正圆在小尺寸下
 * 分辨不出超椭圆，放大到 232px 反而必须用正圆（超椭圆的直线段会显得像个方框）。
 * 描边归一化沿用 `pathLength=100`，与 `arcDashArray / arcDashOffset` 的百分比口径一致。
 */
import { formatDuration } from '../../lib/format';
import { arcDashArray, arcDashOffset, isArcVisible } from '../../lib/ringGeometry';
import type { VisualState } from '../../types/ui';
import { arcSpec } from '../pill/MainButton';

const SIZE = 232;
const CENTER = SIZE / 2;
const RADIUS = 104;
const STROKE = 8;

interface TimerRingProps {
  seconds: number;
  state: VisualState;
  countdown: boolean;
  /** 剩余比例（0..1）；仅倒计时用 */
  progress: number;
  warn: boolean;
  /** 环下方一行小字：事项名 / 状态说明由调用方给 */
  caption: string;
}

export function TimerRing({ seconds, state, countdown, progress, warn, caption }: TimerRingProps) {
  const arc = arcSpec(state, countdown, progress);
  /* frac 归零时不画 bar：round linecap 会留下一个直径 = 描边宽的亮点（同 MainButton） */
  const showBar = isArcVisible(arc.frac);

  return (
    <div className="m-ring" data-state={state} data-warn={warn ? 'true' : 'false'} data-spin={arc.march ? 'true' : 'false'}>
      <svg className="m-ring__svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        {arc.track && <circle className="m-ring__track" cx={CENTER} cy={CENTER} r={RADIUS} strokeWidth={STROKE} />}
        {showBar && (
          <circle
            className="m-ring__bar"
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            strokeWidth={arc.thick ? STROKE + 2 : STROKE}
            pathLength={100}
            strokeDasharray={arcDashArray(arc.frac, arc.march)}
            strokeDashoffset={arc.march ? 0 : arcDashOffset(arc.frac)}
            /* 从 12 点起顺时针：SVG 圆默认从 3 点起，旋转 -90° 才是用户预期的起点。
               这里旋转的是 bar/track 的起笔相位（两种状态同样旋转），不是「行进」——
               行进仍由 dashoffset 动画完成，见 lib/ringGeometry 的注释。 */
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        )}
      </svg>

      <div className="m-ring__center">
        <span className="m-ring__time" role="timer" aria-label={`已计时 ${formatDuration(seconds)}`}>
          {formatDuration(seconds)}
        </span>
        <span className="m-ring__caption">{caption}</span>
      </div>
    </div>
  );
}
