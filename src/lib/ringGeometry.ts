/**
 * Timing — 状态环几何（纯数据 + 纯函数，无 DOM / 无 React）
 * -----------------------------------------------------------------------------
 * viewBox 16×16、描边 2.4 的**超椭圆**（squircle），路径从**顶边中点**起顺时针闭合，
 * 进度弧视觉上从顶部展开。
 *
 * [V0.3.7] 形状从「圆角矩形」换成超椭圆 |x/R|^n + |y/R|^n = 1：
 *   圆角矩形是「直线 + 四分之一圆弧」拼接，切点处曲率从 0 突跳到 1/r，放大看有一道生硬的接缝；
 *   小米 logo 的弧度是**曲率连续**的超椭圆，四边近乎平直、角部缓慢收弯，所以看着更润。
 *   n = 2 是正圆、n → ∞ 是正方形，取 **n = 3** 与小米 logo 同量级。
 *
 * 描边中线口径（`--ring-stroke` = 2.4）：
 *   half   = (16 − stroke) / 2 = 6.8   → 中线轮廓 x/y ∈ [1.2, 14.8]，跨度 13.6
 *   center = 8                          → 起点为 (8, 1.2)
 *
 * 路径由 `squirclePoints` 采样 + Catmull-Rom 过点转贝塞尔**在模块加载时生成**，
 * 而不是硬编码一长串坐标：n 是唯一可调参数（想更圆就取 2.6），且 `ringGeometry.test.ts`
 * 能把每个采样点代回超椭圆方程验算（32 段时最大径向偏差 ≈ 0.01px）。
 * 硬编码的路径没人验得动——V0.3.3 曾把切点写成 5.4，四段弧被拉成椭圆，所有门禁都放行。
 *
 * [V0.3.6] `clampFrac` / `ARC_MIN_FRAC` / `isArcVisible`：弧长归一与「归零不画残点」
 * 的判定都收在这一层，组件只负责渲染（见 docs/decisions/ADR-024.md）。
 */

/** 超椭圆指数：2 = 正圆、3 ≈ 小米 logo、越大越方 */
export const SQUIRCLE_N = 3;

/** 每个象限的采样段数（8 → 整圈 32 段；实测最大径向偏差 ≈ 0.01px，16px 环上不可辨） */
const SEGS_PER_QUADRANT = 8;

/** 环几何常量（描边中线口径；与 `src/styles/tokens/01-primitives.css` 的 --ring-* 对齐） */
export const RING_GEOM = {
  /** viewBox 边长（16 × 16） */
  viewBox: 16,
  /** 描边宽度（--ring-stroke） */
  stroke: 2.4,
  /** 描边中线内缩 = stroke / 2 */
  inset: 1.2,
  /** 超椭圆指数（见 `SQUIRCLE_N`） */
  exponent: SQUIRCLE_N,
  /** 描边中线半边长 = (viewBox − stroke) / 2 */
  half: 6.8,
  /** 路径起点（顶边中点） */
  startX: 8,
  startY: 1.2,
} as const;

/** 坐标保留两位小数：16px 图上前 0.005px 已是亚像素，多余的位数只让路径难读 */
function coord(value: number): string {
  const s = value.toFixed(2).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * 超椭圆上的等角采样点（从顶边中点起、顺时针）。
 * 参数式 x = R·sgn(cos t)|cos t|^(2/n)：t 均匀取点，曲线**按角度匀速**分布，
 * 角部自然获得更密的采样（那里曲率最大）。
 */
export function squirclePoints(
  exponent: number = SQUIRCLE_N,
  half: number = RING_GEOM.half,
  segsPerQuadrant: number = SEGS_PER_QUADRANT,
): Array<[number, number]> {
  const center = RING_GEOM.viewBox / 2;
  const total = segsPerQuadrant * 4;
  const power = 2 / exponent;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < total; i += 1) {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / total;
    const c = Math.cos(t);
    const s = Math.sin(t);
    points.push([
      center + half * Math.sign(c) * Math.abs(c) ** power,
      center + half * Math.sign(s) * Math.abs(s) ** power,
    ]);
  }
  return points;
}

/**
 * 闭合 Catmull-Rom 样条 → 三次贝塞尔路径。
 * 曲线**过每一个采样点**（不是逼近），所以离散化误差只来自段与段之间的插值，
 * 折角由样条本身抹平——这就是超椭圆「曲率连续」在 SVG 里的表达方式。
 */
function splinePath(points: Array<[number, number]>): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  const d: string[] = [`M ${coord(points[0][0])} ${coord(points[0][1])}`];
  for (let i = 0; i < n; i += 1) {
    const [x0, y0] = at(i);
    const [x1, y1] = at(i + 1);
    const [xm, ym] = at(i - 1);
    const [x2, y2] = at(i + 2);
    const c1x = x0 + (x1 - xm) / 6;
    const c1y = y0 + (y1 - ym) / 6;
    const c2x = x1 - (x2 - x0) / 6;
    const c2y = y1 - (y2 - y0) / 6;
    d.push(
      `C ${coord(c1x)} ${coord(c1y)} ${coord(c2x)} ${coord(c2y)} ${coord(x1)} ${coord(y1)}`,
    );
  }
  d.push('Z');
  return d.join(' ');
}

/** 超椭圆环路径：顶边中点起顺时针闭合（`--ring-radius` 的等效半径见 01-primitives.css） */
export const ARC_PATH = splinePath(squirclePoints());

/** `pathLength` 归一值：dasharray / dashoffset 都按 100 计（与路径实际周长解耦） */
export const ARC_PATH_LENGTH = 100;

/**
 * 弧可见阈值（占整周的比例）。
 * 取 0.001 = 万分之一周 ≈ pathLength 0.1 个归一单位：视觉上早就不可分辨，
 * 低于它只剩「round linecap 画出的那个 2.4 直径圆点」，那不是进度，是脏像素。
 */
export const ARC_MIN_FRAC = 0.001;

/**
 * 把任意输入钳成合法的进度比例 [0, 1]。
 * NaN / Infinity 一律退回 0（不可见）——NaN 会让整条 dash 消失，宁可退回「不可见」
 * 也不要画出无法解释的像素。
 */
export function clampFrac(frac: number): number {
  if (!Number.isFinite(frac)) return 0;
  return Math.min(1, Math.max(0, frac));
}

/**
 * 进度弧的 dashoffset：frac = 可见比例（1 = 整周、0 = 不可见）。
 * 越界与 NaN 一律钳到合法区间（见 `clampFrac`）。
 */
export function arcDashOffset(frac: number): number {
  return ARC_PATH_LENGTH * (1 - clampFrac(frac));
}

/**
 * 该比例是否值得画一条弧。
 * `stroke-linecap: round` 下零长度 dash 会渲染成直径 = 描边宽（2.4）的圆点，
 * 倒计时归零瞬间环上会留一个亮点。判定收到这里，组件据此**整条 bar 不渲染**
 * （比切 `stroke-linecap: butt` 更干净：既不留点，也不需要在动画中途改描边端点形态）。
 */
export function isArcVisible(frac: number): boolean {
  return clampFrac(frac) > ARC_MIN_FRAC;
}

/** 归一值的显示化：抹掉浮点尾巴（25.000000000000004 → 25），再转成 SVG 属性串 */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 进度弧的 dasharray。
 * - 静态弧（倒计时 / 暂停 / 待命）：整段 dash `"100"`，弧长由 `arcDashOffset` 单独表达。
 * - 行进弧（正计时 running）：`"25 75"`——可见 25 + 空白 75，只留一段 90° 的短弧，
 *   由 CSS 动画把 `stroke-dashoffset` 从 0 推到 −100（沿路径正方向 = 顺时针）走完一圈。
 *   这样「行进」是**沿真实路径推进**，不是把 `<svg>` 整体旋转：squircle 只有 90° 对称，
 *   transform 旋转会让底轨歪掉、90° 弧段浮出轨道（V0.3.6 P0）。
 */
export function arcDashArray(frac: number, marching: boolean): string {
  if (!marching) return String(ARC_PATH_LENGTH);
  const visible = ARC_PATH_LENGTH * clampFrac(frac);
  return `${tidy(visible)} ${tidy(ARC_PATH_LENGTH - visible)}`;
}
