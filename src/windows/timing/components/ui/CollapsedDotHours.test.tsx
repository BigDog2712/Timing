/**
 * Timing — CollapsedDot 小时档色（[0.13.x]）
 * -----------------------------------------------------------------------------
 * 用户口径：「取消中心原点，改为给小黄点变色，依旧四个小时：不到 1 小时黄、
 * 1–2 内绿、2–3 内紫、3 以上紫」。
 *
 * 这里钉四件事：
 *   1. 中心点**结构上**不存在（找 `.dot__hour`），任何档位都只画「弧 + 黄点」；
 *   2. 档位边界：3599 秒 0 档；3600 / 7200 / 10800 / 14400 秒依次 1/2/3/4 档，
 *      4 小时以上封顶在 4 档；2 档起由 CSS 并成紫色；
 *   3. 换色不影响几何：黄点半径 3、角度仍按秒数走；
 *   4. 已计时口径：倒计时中途满 1 小时、暂停时都保留当前档位。
 *
 * 颜色本身由 CSS 的 `data-hours` 规则承担，断言只钉「档位属性 + 中心无点」——
 * 把色值抄进测试会让主题换色时用例陪着一起红，且证明不了任何用户可见行为。
 */
import { describe, expect, it } from 'vitest';

import {
  registerDotHarness,
  remountDot,
  renderDot,
  setCountdown,
  setTimer,
} from './dotHarness.test-utils';

registerDotHarness();

/** `<defs>` 里的遮罩不上色，不算「画出来的图形」 */
function shapes(r: ReturnType<typeof renderDot>) {
  return [...r.svg.querySelectorAll('circle, line, path, rect, polyline, polygon')].filter(
    (el) => !el.closest('defs'),
  );
}

describe('中心小时点已删除：圆心始终为空', () => {
  it('1 小时 → 没有 .dot__hour，画出来的仍是「弧 + 黄点」两个图形', () => {
    /* +1 秒：整 1 小时的弧头与弧尾重合，`isArcVisible` 按口径不画弧，只剩黄点 */
    setTimer(3601, 'running');
    const r = renderDot();
    expect(r.dot.querySelector('.dot__hour')).toBeNull();
    expect(shapes(r)).toHaveLength(2);
    expect(r.mark.getAttribute('r')).toBe('3');
  });

  it('2 / 4 小时 → 中心也没有新增图形', () => {
    setTimer(7201, 'running');
    expect(shapes(renderDot())).toHaveLength(2);
    remountDot();
    setTimer(14401, 'running');
    expect(shapes(renderDot())).toHaveLength(2);
  });
});

describe('小时档位（data-hours）', () => {
  it('不足 1 小时 → 0 档（3599 秒仍是 0）', () => {
    setTimer(3599, 'running');
    expect(renderDot().dot.dataset.hours).toBe('0');
  });

  it('1 / 2 / 3 小时 → 1 / 2 / 3 档', () => {
    setTimer(3600, 'running');
    expect(renderDot().dot.dataset.hours).toBe('1');
    remountDot();
    setTimer(7200, 'running');
    expect(renderDot().dot.dataset.hours).toBe('2');
    remountDot();
    setTimer(10800, 'running');
    expect(renderDot().dot.dataset.hours).toBe('3');
  });

  it('4 小时及以上封顶在 4 档（10 小时也是 4，不会溢出成第 5 档）', () => {
    setTimer(14400, 'running');
    expect(renderDot().dot.dataset.hours).toBe('4');
    remountDot();
    setTimer(36000, 'running');
    expect(renderDot().dot.dataset.hours).toBe('4');
  });

  it('档位边界前一秒仍留在上一档（7199 秒 = 1 档，7200 秒 = 2 档）', () => {
    setTimer(7199, 'running');
    expect(renderDot().dot.dataset.hours).toBe('1');
    remountDot();
    setTimer(7200, 'running');
    expect(renderDot().dot.dataset.hours).toBe('2');
  });
});

describe('换色不影响黄点几何', () => {
  it('1.5 小时（绿档）与 2.5 小时（紫档）都在 6 点：换色不挪点', () => {
    setTimer(5400, 'running');
    const green = renderDot();
    expect(green.dot.dataset.hours).toBe('1');
    expect(green.markAngle).toBeCloseTo(180, 0);
    expect(green.mark.getAttribute('r')).toBe('3');

    remountDot();
    setTimer(9000, 'running');
    const violet = renderDot();
    expect(violet.dot.dataset.hours).toBe('2');
    expect(violet.markAngle).toBeCloseTo(180, 0);
    expect(violet.mark.getAttribute('r')).toBe('3');
    expect(violet.mark.getAttribute('cx')).toBe(green.mark.getAttribute('cx'));
  });
});

describe('已计时口径', () => {
  it('倒计时已计满 1 小时（剩余 1 小时）→ 1 档，不随剩余时间倒着走', () => {
    setCountdown(3600, 7200);
    const r = renderDot();
    expect(r.dot.dataset.hours).toBe('1');
    expect(r.dot.querySelector('.dot__hour')).toBeNull();
  });

  it('暂停时保留当前档位（7300 秒 → 2 档）', () => {
    setTimer(7300, 'paused');
    expect(renderDot().dot.dataset.hours).toBe('2');
  });
});