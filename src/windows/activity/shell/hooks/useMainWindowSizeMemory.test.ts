import { beforeEach, describe, expect, it } from "vitest";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_SIZE_STORAGE_KEY,
  clampWindowSize,
  readStoredWindowSize,
  writeStoredWindowSize,
} from "./useMainWindowSizeMemory";

/**
 * [v3.1] 窗口大小记忆的**存取口径**：存逻辑像素、坏存档当没存过、恢复前按下界与屏幕
 * 可用区钳制（换了小显示器时，上次的 1600 宽不能把窗口推出屏幕外）。
 */
beforeEach(() => {
  window.localStorage.clear();
});

describe("窗口大小存档", () => {
  it("没存过 → null（回 Rust 侧默认 1100×736，而不是凭空造一个尺寸）", () => {
    expect(readStoredWindowSize()).toBeNull();
  });

  it("写进去再读回来是同一对数", () => {
    writeStoredWindowSize({ width: 1320, height: 880 });
    expect(readStoredWindowSize()).toEqual({ width: 1320, height: 880 });
  });

  it("坏 JSON / 缺字段 → null，不抛错", () => {
    window.localStorage.setItem(WINDOW_SIZE_STORAGE_KEY, "{oops");
    expect(readStoredWindowSize()).toBeNull();
    window.localStorage.setItem(WINDOW_SIZE_STORAGE_KEY, JSON.stringify({ width: 1200 }));
    expect(readStoredWindowSize()).toBeNull();
  });

  it("钳到下界：比最小窗还小的存档不许把窗改成一块板都放不下", () => {
    const clamped = clampWindowSize({ width: 400, height: 300 });
    expect(clamped.width).toBe(MIN_WINDOW_WIDTH);
    expect(clamped.height).toBe(MIN_WINDOW_HEIGHT);
  });

  it("钳到屏幕可用区：不越过当前显示器（量不到屏幕时不上钳）", () => {
    const clamped = clampWindowSize({ width: 99_999, height: 99_999 });
    const { availWidth, availHeight } = window.screen;
    /* jsdom 的 screen 是 0（"量不到"）：此时唯一正确的行为是**别乱钳**，
     * 否则每次恢复都会把窗口压成 0×0。真机上两条都要成立。 */
    expect(clamped.width).toBe(availWidth > 0 ? availWidth : 99_999);
    expect(clamped.height).toBe(availHeight > 0 ? availHeight : 99_999);
  });
});
