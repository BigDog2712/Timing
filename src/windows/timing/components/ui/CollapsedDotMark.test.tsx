/**
 * Timing — CollapsedDot 黄点（[0.13.x]）
 * -----------------------------------------------------------------------------
 * 用户口径：「小圆点形态 UI 优化，内部分针过于具象化，优化为单个黄色圆点（参考默认设置
 * 颜色），圆点在圆指针顶部位置」。所以分针（`line.dot__needle`）与圆心轴心
 * （`circle.dot__pin`）**删除**，换成一枚实心黄点（`circle.dot__mark`）：
 *   位置 = 黄点嵌在环的断口里（轨道半径 = 环半径），角度**原样接过**原针口径；
 *   环只由实色弧构成，没有半透明底环；断口可见、两端圆角，**UI 图形起点**随黄点绕圈；
 *   正计时的弧尾 = 黄点、弧头 = 绝对秒位置（0 点在 12 点、一秒 6°）。
 *
 * 三条判据（缺一不可）：
 *   1. 分针 / 轴心**结构上**不存在 —— 按 DOM 结构断言（找不到 `.dot__needle` /
 *      `.dot__pin`、SVG 里没有 `<line>`、可见图形元素恰好 2 个；`<defs>` 里的遮罩不算）。
 *   2. 黄点存在，且位置随秒数变化 —— 正计时与倒计时**两种口径各一次**，都拿两个不同的
 *      `displaySec` 比圆周坐标，并顺带钉住 0° / 90° / 180° 这些可手算的位置。
 *   3. 断口与圆角仍在 —— 防止「顺手把弧删了」「把断口改窄到看不见」或把断口钉死在 12 点；
 *      同时钉住「遮罩 / 弧尾随黄点转、弧头不随黄点转」。
 *
 * 几何量全部从渲染出来的 DOM 属性反推（见 `dotHarness.test-utils.tsx` 的 `renderDot`），
 * 不在测试里重抄一遍公式。
 */
import { describe, expect, it } from 'vitest';

import { RING_GAP_DEG } from './CollapsedDot';
import {
  markPoint,
  registerDotHarness,
  remountDot,
  renderDot,
  setCountdown,
  setTimer,
} from './dotHarness.test-utils';

registerDotHarness();

describe('结构：分针与轴心已删除，只剩弧 + 一枚黄点', () => {
  it('没有分针（.dot__needle）、没有轴心（.dot__pin）、SVG 里没有 <line>', () => {
    setTimer(30, 'running');
    const r = renderDot();
    expect(r.dot.querySelector('.dot__needle')).toBeNull();
    expect(r.dot.querySelector('.dot__pin')).toBeNull();
    expect(r.svg.querySelector('line')).toBeNull();
  });

  it('画出来的就是「弧 + 黄点」：可见图形元素恰好 2 个，且黄点半径 3', () => {
    setTimer(30, 'running');
    const r = renderDot();
    /* 遮罩圆在 <defs> 里、不直接上色，不算「画出来的图形」 */
    const shapes = [...r.svg.querySelectorAll('circle, line, path, rect, polyline, polygon')].filter(
      (el) => !el.closest('defs'),
    );
    expect(shapes).toHaveLength(2);
    expect(r.mark.tagName.toLowerCase()).toBe('circle');
    expect(r.mark.getAttribute('r')).toBe('3');
  });
});

describe('黄点位置（正计时：displaySec % 3600，一秒 0.1°）', () => {
  it('0 秒 → 12 点；900 秒 → 3 点；1800 秒 → 6 点', () => {
    setTimer(0, 'running');
    expect(renderDot().markAngle).toBeCloseTo(0, 3);
    remountDot();
    setTimer(900, 'running');
    expect(renderDot().markAngle).toBeCloseTo(90, 3);
    remountDot();
    setTimer(1800, 'running');
    expect(renderDot().markAngle).toBeCloseTo(180, 3);
  });

  it('两个不同 displaySec → 圆周坐标不同（点跟着角度走，不是钉在圆心或固定死）', () => {
    setTimer(100, 'running');
    const at100 = markPoint(renderDot());
    remountDot();
    setTimer(1900, 'running');
    const at1900 = markPoint(renderDot());
    expect(at1900).not.toEqual(at100);
    expect(at1900.x).not.toBeCloseTo(at100.x, 2);
  });

  it('3599 秒 → 359.9°；3600 秒回 12 点，且只向前 0.1°（不跳变）', () => {
    setTimer(3599, 'running');
    expect(renderDot().markAngle).toBeCloseTo(359.9, 1);
    remountDot();
    setTimer(3600, 'running');
    const at = renderDot().markAngle;
    expect(at).toBeCloseTo(0, 1);
    /* 走「向前 0.1°」而不是「倒退 359.9°」 */
    const forward = (at - 359.9 + 360) % 360;
    expect(forward).toBeCloseTo(0.1, 1);
    expect(forward).toBeLessThan(1);
  });
});

describe('黄点与环结合（[0.13.x] 黄点搬到环身上）', () => {
  it('黄点轨道半径 = 弧半径：点嵌在环身上，不再飘在环内', () => {
    setTimer(930, 'running');
    const r = renderDot();
    const [, , vbW = '0'] = (r.svg.getAttribute('viewBox') ?? '').split(/\s+/);
    const center = Number(vbW) / 2;
    const distance = Math.hypot(
      Number(r.mark.getAttribute('cx')) - center,
      Number(r.mark.getAttribute('cy')) - center,
    );
    expect(r.arc).not.toBeNull();
    expect(distance).toBeCloseTo(Number(r.arc?.getAttribute('r')), 3);
  });

  it('没有预览用的半透明底环：`.dot__rim` 不存在', () => {
    setTimer(930, 'running');
    const r = renderDot();
    expect(r.dot.querySelector('.dot__rim')).toBeNull();
    expect(r.arc).not.toBeNull();
  });

  it('空闲：断口保留（几何 82° + 两端圆角后可见约 60°），计时 0 点仍在 12 点', () => {
    /* 真正的 idle（arcSpec 的 frac=1），不是「运行到 0 秒」——后者的增长弧是空的 */
    const r = renderDot();
    if (!r.arc) throw new Error('未渲染进度弧');
    expect(r.markAngle).toBeCloseTo(0, 3);
    /* 计时弧按整圈铺满（绝对位置，0 点在 12 点），断口由遮罩挖出 */
    expect(r.visible).toBeCloseTo(100, 3);
    expect(r.gap).toBeCloseTo(0, 3);
    expect(r.arcRotate).toBeCloseTo(-90, 3);

    /* 遮罩 dash：露出环口以外的 278°，挖空 82° */
    expect(r.maskVisible).toBeCloseTo((360 - RING_GAP_DEG) / 3.6, 3);
    expect(r.maskGap).toBeCloseTo(RING_GAP_DEG / 3.6, 3);
    expect(r.maskVisible + r.maskGap).toBeCloseTo(100, 3);
    /* 黄点在 12 点 → 遮罩旋转 −90 + 41 = −49，缺口正落在顶部 */
    expect(r.maskRotate).toBeCloseTo(-90 + RING_GAP_DEG / 2, 3);

    /* round 端帽沿路径各多画半个描边宽：可见断口 = 几何环口 − 2 × 端帽角 */
    const radius = Number(r.mask.getAttribute('r'));
    const stroke = Number(r.mask.getAttribute('stroke-width'));
    const capDeg = (stroke / 2 / radius) * (180 / Math.PI);
    const visibleGap = r.maskGap * 3.6 - 2 * capDeg;
    const markWidthDeg =
      (2 * Math.asin(Number(r.mark.getAttribute('r')) / radius) * 180) / Math.PI;
    expect(visibleGap).toBeCloseTo(60, 0);
    /* 可见断口仍宽于黄点遮掉的角 → 两侧看得到空气，不会回到「一整圈」 */
    expect(visibleGap).toBeGreaterThan(markWidthDeg);
  });

  it('断口与弧尾跟着黄点绕圈；弧头仍按绝对秒位置走', () => {
    /* 30s 与 930s 都是「分钟内第 30 秒」：弧头都应在 180°；
       黄点从 3° 走到 93°，断口 / 弧尾跟着走 90°。 */
    const head = (r: ReturnType<typeof renderDot>) =>
      (r.arcRotate + 90 + r.visible * 3.6) % 360;

    setTimer(30, 'running');
    const at30 = renderDot();
    /* markAngle 由 round3 后的 cx/cy 反推，旋转也 round3 → 容差 2 位 */
    expect(at30.maskRotate).toBeCloseTo(at30.markAngle - 90 + RING_GAP_DEG / 2, 2);
    expect(at30.arcRotate).toBeCloseTo(at30.markAngle - 90, 2);
    expect(head(at30)).toBeCloseTo(180, 0);

    remountDot();
    setTimer(930, 'running');
    const at930 = renderDot();
    expect(at930.maskRotate).toBeCloseTo(at930.markAngle - 90 + RING_GAP_DEG / 2, 2);
    /* 30s → 930s 黄点走 90°，UI 图形起点 / 弧尾跟着走 90° */
    expect(at930.maskRotate - at30.maskRotate).toBeCloseTo(90, 1);
    expect(at930.arcRotate - at30.arcRotate).toBeCloseTo(90, 1);
    /* 弧头不随黄点转：两个时刻都停在 180°（绝对秒位置） */
    expect(head(at930)).toBeCloseTo(180, 0);
  });
});

describe('黄点位置（倒计时：已用比例 × 360°，一圈 = 总时长）', () => {
  it('刚开始 / 过半 / 剩 3/4：0° → 180° → 90°', () => {
    setCountdown(0, 120);
    expect(renderDot().markAngle).toBeCloseTo(0, 3);
    remountDot();
    setCountdown(60, 120);
    expect(renderDot().markAngle).toBeCloseTo(180, 3);
    remountDot();
    setCountdown(30, 120);
    expect(renderDot().markAngle).toBeCloseTo(90, 3);
  });

  it('倒计时两个不同秒数 → 坐标不同（口径是按已用比例，不是 0.1°/秒）', () => {
    setCountdown(10, 120);
    const at10 = markPoint(renderDot());
    remountDot();
    setCountdown(40, 120);
    const at40 = markPoint(renderDot());
    expect(at40).not.toEqual(at10);
    /* 30 秒差 = 90°：坐标差必须是实打实的几个像素，不是浮点噪声 */
    expect(Math.abs(at40.x - at10.x) + Math.abs(at40.y - at10.y)).toBeGreaterThan(3);
  });
});
