/**
 * Timing — 便利贴窗口几何持久化（sticky-note.md 与架构交叉点 · K-15 / K-23）
 * -----------------------------------------------------------------------------
 * - 订阅 Tauri `onMoved` / `onResized`：物理像素 ÷ scaleFactor → 逻辑像素（K-15），
 *   经 noteStore.patchGeom 合并去抖 300ms 后落盘（K-23）。
 * - 硬钳制的 min/max 由**窗口配置**强制（160×120 / 900×900），前端只负责持久化，
 *   **不拦截拖拽**（舒适上限 640×480 仅作软提示 → 返回 oversize 供 UI 弱化）。
 * - 非 Tauri（浏览器 dev）为 no-op。
 */
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '../lib/window';
import { isTauri } from '../services/ipc';
import { useNoteStore } from '../stores/noteStore';
import { NOTE_COMFORT_MAX_H, NOTE_COMFORT_MAX_W } from '../types/domain';

/** 返回当前尺寸是否超出「舒适上限」（软提示，不拦截） */
export function useNoteGeometry(): boolean {
  const [oversize, setOversize] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let scale = 1;
    let disposed = false;

    void appWindow
      .scaleFactor()
      .then((s) => {
        if (!disposed && s > 0) scale = s;
      })
      .catch(() => undefined);

    /* 首帧存量尺寸（重启恢复后的舒适度提示） */
    void appWindow
      .innerSize()
      .then((size) => {
        if (disposed) return;
        setOversize(size.width / scale > NOTE_COMFORT_MAX_W || size.height / scale > NOTE_COMFORT_MAX_H);
      })
      .catch(() => undefined);

    const unMoved = appWindow.onMoved(({ payload }) => {
      useNoteStore.getState().patchGeom({
        posX: Math.round(payload.x / scale),
        posY: Math.round(payload.y / scale),
      });
    });
    const unResized = appWindow.onResized(({ payload }) => {
      const w = Math.round(payload.width / scale);
      const h = Math.round(payload.height / scale);
      setOversize(w > NOTE_COMFORT_MAX_W || h > NOTE_COMFORT_MAX_H);
      useNoteStore.getState().patchGeom({ width: w, height: h });
    });

    return () => {
      disposed = true;
      void unMoved.then((f) => f()).catch(() => undefined);
      void unResized.then((f) => f()).catch(() => undefined);
    };
  }, []);

  return oversize;
}
