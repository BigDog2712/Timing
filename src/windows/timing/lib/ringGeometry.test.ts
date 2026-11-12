import { describe, expect, it } from 'vitest';
import {
  ARC_MIN_FRAC,
  ARC_PATH,
  ARC_PATH_LENGTH,
  RING_GEOM as G,
  SQUIRCLE_N,
  arcDashArray,
  arcDashOffset,
  clampFrac,
  isArcVisible,
  squirclePoints,
} from './ringGeometry';

interface Command {
  cmd: string;
  nums: number[];
}

/** 把 `d` 拆成「命令 + 数字参数」序列（本路径只用 M/C/Z，不引第三方解析器） */
function parse(path: string): Command[] {
  return [...path.matchAll(/([MmCcZz])([^MmCcZz]*)/g)].map((m) => ({
    cmd: m[1].toUpperCase(),
    nums: (m[2].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number),
  }));
}

/** 走一遍路径，只收**曲线上的点**（M 的起点 + 每段 C 的终点；控制点不在曲线上，不参与验算） */
function trace(path: string) {
  let cur: [number, number] = [0, 0];
  const points: Array<[number, number]> = [];
  let closed = false;
  for (const { cmd, nums } of parse(path)) {
    if (cmd === 'M') {
      cur = [nums[0] ?? 0, nums[1] ?? 0];
      points.push(cur);
    } else if (cmd === 'C') {
      cur = [nums[4] ?? 0, nums[5] ?? 0];
      points.push(cur);
    } else if (cmd === 'Z') {
      closed = true;
    }
  }
  return { points, closed, start: points[0] as [number, number], end: cur };
}

const shape = trace(ARC_PATH);
const xs = shape.points.map((p) => p[0]);
const ys = shape.points.map((p) => p[1]);
const center = G.viewBox / 2;
/** 描边中线四边形的大值边：viewBox − inset = 14.8 */
const sideHigh = G.viewBox - G.inset;

/** 把点代回超椭圆方程，返回 |(|dx|/R)^n + (|dy|/R)^n − 1|（0 = 正好在曲线上） */
function squircleResidual(x: number, y: number, exponent = SQUIRCLE_N): number {
  const dx = Math.abs(x - center) / G.half;
  const dy = Math.abs(y - center) / G.half;
  return Math.abs(dx ** exponent + dy ** exponent - 1);
}

describe('ringGeometry · 路径是超椭圆（V0.3.7 外形改造）', () => {
  it('只用 M / C / Z，且由 32 段贝塞尔组成（每象限 8 段）', () => {
    const cmds = parse(ARC_PATH).map((c) => c.cmd);
    expect(new Set(cmds)).toEqual(new Set(['M', 'C', 'Z']));
    expect(cmds.filter((c) => c === 'C')).toHaveLength(32);
  });

  it('每个曲线点都落在超椭圆上（容差 1%，主要来自坐标两位小数的截断）', () => {
    // 这是整个形状改造的核心防线：圆角矩形会被这条断言判死（切点处 residual ≈ 0.19），
    // 写错指数 n 或半径同样判死——而 SVG 照样会渲染出一个「看着像方的」脏形状。
    for (const [x, y] of shape.points) {
      expect(squircleResidual(x as number, y as number)).toBeLessThan(0.01);
    }
  });

  it('指数 n = 3（小米 logo 量级），介于正圆 n=2 与正方形之间', () => {
    expect(SQUIRCLE_N).toBe(3);
    // 45° 方向的半径（i=12 → t = 45°）：|x|=|y| 处 x = R / 2^(1/n)，故 hypot = √2·R / 2^(1/n)。
    // n=2 → 正好 R（正圆的角），n 越大越贴近正方形的角 √2·R ≈ 9.62，即越方。
    const arm = (n: number) => {
      const [x, y] = squirclePoints(n)[12] ?? [center, center];
      return Math.hypot((x as number) - center, (y as number) - center);
    };
    expect(arm(2)).toBeCloseTo(G.half, 2);
    expect(arm(3)).toBeGreaterThan(arm(2));
    expect(arm(4)).toBeGreaterThan(arm(3));
    // n=3 的 45° 半径 ≈ 1.1225R ≈ 7.63，夹在正圆 6.8 与正方形角 9.62 之间
    expect(arm(3)).toBeCloseTo(G.half * Math.SQRT2 / 2 ** (1 / 3), 2);
  });

  it('x / y 极值贴着描边中线四边形（inset 与 大值边）', () => {
    expect(Math.min(...xs)).toBeCloseTo(G.inset, 2);
    expect(Math.max(...xs)).toBeCloseTo(sideHigh, 2);
    expect(Math.min(...ys)).toBeCloseTo(G.inset, 2);
    expect(Math.max(...ys)).toBeCloseTo(sideHigh, 2);
  });

  it('沿路径顺时针推进一整圈（极角单调、总转角 2π，不折返）', () => {
    // 逐点 unwrap 极角（跨 +π 时补 2π）。注意超椭圆是**等参数**采样，极角本身不均匀
    // （角部变化快），所以只断言「单调 + 总转角恰好一圈 + 每步不离谱」，
    // 不断言每步等分——那会把参数化误当成极角等分。
    const ring = shape.points.slice(0, -1); // 最后一点是回到起点的重复项，去掉
    const angles = ring.map(([x, y]) =>
      Math.atan2((y as number) - center, (x as number) - center),
    );
    const step = (2 * Math.PI) / ring.length;
    let total = 0;
    for (let i = 1; i < angles.length; i += 1) {
      let delta = (angles[i] as number) - (angles[i - 1] as number);
      while (delta <= 0) delta += 2 * Math.PI;
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(step * 2.5);
      total += delta;
    }
    // 补上「最后一点 → 起点」那一步，闭合后总转角应正好 2π
    let closing = (angles[0] as number) - (angles[angles.length - 1] as number);
    while (closing <= 0) closing += 2 * Math.PI;
    expect(total + closing).toBeCloseTo(2 * Math.PI, 6);
  });

  it('从顶边中点起笔、以 Z 闭合，且终点回到起点', () => {
    expect(ARC_PATH.startsWith('M 8 1.2')).toBe(true);
    expect(ARC_PATH.trimEnd().endsWith('Z')).toBe(true);
    expect(shape.closed).toBe(true);
    expect(shape.start[0]).toBeCloseTo(G.startX, 2);
    expect(shape.start[1]).toBeCloseTo(G.startY, 2);
    expect(shape.end[0]).toBeCloseTo(shape.start[0], 2);
    expect(shape.end[1]).toBeCloseTo(shape.start[1], 2);
  });
});

describe('arcDashOffset', () => {
  it('按比例换算并覆盖两端点', () => {
    expect(arcDashOffset(1)).toBe(0);
    expect(arcDashOffset(0)).toBe(ARC_PATH_LENGTH);
    expect(arcDashOffset(0.5)).toBe(50);
  });

  it('越界与 NaN 一律钳到 [0,1]', () => {
    expect(arcDashOffset(-1)).toBe(ARC_PATH_LENGTH);
    expect(arcDashOffset(2)).toBe(0);
    expect(arcDashOffset(Number.NaN)).toBe(ARC_PATH_LENGTH);
  });

  it('与 clampFrac 同源：dashoffset = 100 × (1 − clampFrac)', () => {
    for (const frac of [-0.5, 0, 0.25, 0.5, 0.75, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(arcDashOffset(frac)).toBeCloseTo(ARC_PATH_LENGTH * (1 - clampFrac(frac)), 10);
    }
  });
});

describe('clampFrac', () => {
  it('钳到 [0,1]，非有限值退回 0（不可见）', () => {
    expect(clampFrac(1)).toBe(1);
    expect(clampFrac(0)).toBe(0);
    expect(clampFrac(0.4)).toBeCloseTo(0.4, 12);
    expect(clampFrac(-0.2)).toBe(0);
    expect(clampFrac(2)).toBe(1);
    expect(clampFrac(Number.NaN)).toBe(0);
    expect(clampFrac(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampFrac(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('isArcVisible（D5：round linecap 的零长度圆点）', () => {
  it('阈值为万分之一周，且必须严格大于它才算可见', () => {
    expect(ARC_MIN_FRAC).toBe(0.001);
    expect(isArcVisible(0)).toBe(false);
    expect(isArcVisible(ARC_MIN_FRAC)).toBe(false);
    expect(isArcVisible(ARC_MIN_FRAC * 2)).toBe(true);
    expect(isArcVisible(1)).toBe(true);
  });

  it('负值 / NaN / 越界与 clampFrac 一致', () => {
    expect(isArcVisible(-1)).toBe(false);
    expect(isArcVisible(Number.NaN)).toBe(false);
    expect(isArcVisible(5)).toBe(true);
  });
});

describe('arcDashArray', () => {
  it('静态弧一律整段 "100"（弧长由 dashoffset 单独表达）', () => {
    for (const frac of [0, 0.01, 0.25, 0.75, 1]) {
      expect(arcDashArray(frac, false)).toBe('100');
    }
  });

  it('行进弧拆成「可见 空白」，90° 弧 = "25 75"，两段和恒为 100', () => {
    expect(arcDashArray(0.25, true)).toBe('25 75');
    expect(arcDashArray(0.5, true)).toBe('50 50');
    // 浮点尾巴被抹掉：0.1 不能渲染成 "10.000000000000002 89.99999999999999"
    expect(arcDashArray(0.1, true)).toBe('10 90');
    for (const frac of [0.1, 0.25, 0.5, 0.75, 1]) {
      const [on, off] = arcDashArray(frac, true).split(' ').map(Number);
      expect((on ?? 0) + (off ?? 0)).toBeCloseTo(ARC_PATH_LENGTH, 6);
    }
  });

  it('越界 / NaN 与 clampFrac 同源（NaN 钳到 0 → "0 100"）', () => {
    expect(arcDashArray(-1, true)).toBe('0 100');
    expect(arcDashArray(Number.NaN, true)).toBe('0 100');
    expect(arcDashArray(3, true)).toBe('100 0');
  });
});
