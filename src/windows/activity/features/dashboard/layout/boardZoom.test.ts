import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, clampZoom, readStoredZoom } from "./useBoardZoom";

/**
 * [v3.1] 缩放的**纯逻辑**判据。行为判据（滚轮锚点、Ctrl 修饰键）在
 * `dashboardBoardLayout.test.ts` 的 p01c 里钉源码形状，这里钉数值口径：
 * 钳制范围、坏存档的兜底、以及"记不住就得回 100% 而不是 0"。
 */
beforeEach(() => {
  window.localStorage.clear();
});

describe("clampZoom", () => {
  it("钳在 0.5–2", () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(9)).toBe(2);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it("非数字回默认倍率，不是 0（0 会让画布整块消失）", () => {
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_ZOOM);
  });

  it("保留三位小数：滚轮连乘会攒出一串浮点尾巴", () => {
    expect(clampZoom(0.8123456789)).toBe(0.812);
  });
});

describe("readStoredZoom", () => {
  it("没存过 → 100%", () => {
    expect(readStoredZoom()).toBe(1);
  });

  it("存过的值读回来", () => {
    window.localStorage.setItem("patina:dashboard-zoom:v1", "1.35");
    expect(readStoredZoom()).toBe(1.35);
  });

  it("存档是坏字符串 / 越界值 → 回默认，不抛错", () => {
    window.localStorage.setItem("patina:dashboard-zoom:v1", "abc");
    expect(readStoredZoom()).toBe(1);
    window.localStorage.setItem("patina:dashboard-zoom:v1", "50");
    expect(readStoredZoom()).toBe(2);
  });
});
