/**
 * [v3.1] 记住主界面（`patina` 分析窗）的窗口大小，下次打开时恢复。
 *
 * 为什么前端还要再记一遍：`window-state` 插件只在**进程退出**时落盘。分析窗是"用完关掉、
 * 需要时再从托盘叫出来"的用法 —— 用户拉大窗 → 关掉 → 再叫出来，全程进程没退，插件那份
 * 存档还是旧的，于是每次都弹回 1100×736。这里的存档写在 **resize 结束那一刻**，
 * 与进程生死无关。
 *
 * 存**逻辑像素**：物理像素跨 DPI 会漂（125% 屏存 1240×826，到 100% 屏就大一圈）。
 * 恢复前按当前屏幕可用区钳一次，并跳过"当前是最大化"的情况 —— 否则最大化状态下
 * 唤出窗口会被这条复原逻辑拽回非最大化尺寸。
 */
import { useEffect, useRef } from "react";
import {
  readCurrentWindowLogicalSize,
  readCurrentWindowMaximized,
  resizeCurrentWindowTo,
  watchCurrentWindowResized,
  type LogicalWindowSize,
} from "../../platform/desktop/windowControlGateway.ts";

export const WINDOW_SIZE_STORAGE_KEY = "patina:window-size:v1";
/** 与 Rust 侧 `MAIN_WINDOW_MIN_WIDTH/HEIGHT`（`insight/main_window.rs`）同值：更小就不是这块板了 */
export const MIN_WINDOW_WIDTH = 900;
export const MIN_WINDOW_HEIGHT = 636;
const SAVE_DELAY_MS = 420;
/** 复原本身会触发若干次 resize，这段时间内不落盘（避免把中间态写成"用户的尺寸"） */
const RESTORE_GRACE_MS = 700;

export function readStoredWindowSize(): LogicalWindowSize | null {
  try {
    const raw = window.localStorage.getItem(WINDOW_SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { width, height };
  } catch {
    /* 坏 JSON / 存储被禁：当作没记过，回 Rust 侧默认尺寸 */
    return null;
  }
}

export function writeStoredWindowSize(size: LogicalWindowSize): void {
  try {
    window.localStorage.setItem(WINDOW_SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    /* 落盘失败不影响本次会话 */
  }
}

/** 钳到下界与当前屏幕可用区之间：换了小显示器时，"上次 1600 宽"不能把窗口推到屏幕外。 */
export function clampWindowSize(size: LogicalWindowSize): LogicalWindowSize {
  const screenWidth = typeof window === "undefined" ? 0 : window.screen?.availWidth ?? 0;
  const screenHeight = typeof window === "undefined" ? 0 : window.screen?.availHeight ?? 0;
  const maxWidth = screenWidth > 0 ? screenWidth : Number.POSITIVE_INFINITY;
  const maxHeight = screenHeight > 0 ? screenHeight : Number.POSITIVE_INFINITY;
  return {
    width: Math.round(Math.min(Math.max(size.width, MIN_WINDOW_WIDTH), maxWidth)),
    height: Math.round(Math.min(Math.max(size.height, MIN_WINDOW_HEIGHT), maxHeight)),
  };
}

export function useMainWindowSizeMemory(): void {
  const maximizedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const graceUntil = useRef(0);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    let unlisten: (() => void) | null = null;

    const saveCurrentSize = async () => {
      if (disposed.current || maximizedRef.current) return;
      const [size, maximized] = await Promise.all([
        readCurrentWindowLogicalSize(),
        readCurrentWindowMaximized(),
      ]);
      if (disposed.current || maximized || !size) return;
      /* 最小化 / 系统动画中间态会给出一个不合理的尺寸，不要拿它覆盖用户存的 */
      if (size.width < MIN_WINDOW_WIDTH || size.height < MIN_WINDOW_HEIGHT) return;
      writeStoredWindowSize(size);
    };

    const scheduleSave = () => {
      if (Date.now() < graceUntil.current) return;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void saveCurrentSize();
      }, SAVE_DELAY_MS);
    };

    const boot = async () => {
      const maximized = await readCurrentWindowMaximized();
      maximizedRef.current = maximized;
      const saved = readStoredWindowSize();
      if (saved && !maximized) await resizeCurrentWindowTo(clampWindowSize(saved));
      graceUntil.current = Date.now() + RESTORE_GRACE_MS;
      if (disposed.current) return;
      try {
        unlisten = await watchCurrentWindowResized(scheduleSave);
      } catch (error) {
        console.warn("watch current window resize failed", error);
      }
    };
    void boot();

    return () => {
      disposed.current = true;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      unlisten?.();
    };
  }, []);
}
