/**
 * Timing — CollapsedDot 黄点（[0.13.x]）
 * -----------------------------------------------------------------------------
 * 用户口径：「小圆点形态 UI 优化，内部分针过于具象化，优化为单个黄色圆点（参考默认设置
 * 颜色），圆点在圆指针顶部位置」。所以分针（`line.dot__needle`）与圆心轴心
 * （`circle.dot__pin`）**删除**，换成一枚实心黄点（`circle.dot__mark`）：
 *   位置 = 原针尖端所在的圆周（轨道半径仍是原针长 7），角度**原样接过**原针口径。
 *
 * 三条判据（缺一不可）：
 *   1. 分针 / 轴心**结构上**不存在 —— 按 DOM 结构断言（找不到 `.dot__needle` /
 *      `.dot__pin`、SVG 里没有 `<line>`、图形元素恰好 3 个）。刻意**不**去 grep 源码里的
 *      `NEEDLE` 字样：那种哨兵会被一句注释或一个历史变量名误伤，与「到底画了什么」无关。
 *   2. 黄点存在，且位置随秒数变化 —— 正计时与倒计时**两种口径各一次**，都拿两个不同的
 *      `displaySec` 比圆周坐标，并顺带钉住 0° / 90° / 180° 这些可手算的位置。
 *   3. 外环与进度弧仍在渲染 —— 防止「顺手把弧删了」（这条在外环那个文件里也有一份）。
 *
 * 几何量全部从渲染出来的 `cx / cy` 反推（见 `dotHarness.test-utils.tsx` 的 `renderDot`），
 * 不在测试里重抄一遍公式。
 */
import { describe, expect, it } from 'vitest';

import {
  markPoint,
  registerDotHarness,
  remountDot,
  renderDot,
  setCountdown,
  setTimer,
} from './dotHarness.test-utils';

registerDotHarness();

describe('结构：分针与轴心已删除，只剩细框 + 弧 + 一枚黄点', () => {
  it('没有分针（.dot__needle）、没有轴心（.dot__pin）、SVG 里没有 <line>', () => {
    setTimer(30, 'running');
    const r = renderDot();
    expect(r.dot.querySelector('.dot__needle')).toBeNull();
    expect(r.dot.querySelector('.dot__pin')).toBeNull();
    expect(r.svg.querySelector('line')).toBeNull();
  });

  it('画出来的就是「细框 + 弧 + 黄点」：图形元素恰好 3 个，且黄点是半径 2.4 的填充圆', () => {
    setTimer(30, 'running');
    const r = renderDot();
    const shapes = r.svg.querySelectorAll('circle, line, path, rect, polyline, polygon');
    expect(shapes).toHaveLength(3);
    expect(r.mark.tagName.toLowerCase()).toBe('circle');
    expect(r.mark.getAttribute('r')).toBe('2.4');
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
