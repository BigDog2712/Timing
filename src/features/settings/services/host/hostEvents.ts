/**
 * 分析窗侧的事件订阅（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 宿主那份 `hooks/useTauriEvent.ts` 走 `services/ipc` 的 `onIpcEvent`，两边都在主窗侧，
 * 分析窗不能 import。这里用 `@tauri-apps/api/event` 的 `listen` 直接实现，**语义逐字照抄**：
 * handler 经 ref 转发，订阅只随事件名重建一次（内联 handler 不会导致反复重订阅），
 * unmount 必须在 cleanup 里 unlisten（K-8，漏了就是「关了设置页后台还在收事件」）。
 *
 * 权限：`core:event:allow-listen` / `allow-unlisten` 已在 `capabilities/patina.json` 里
 * （既有授权，本轮不加）。
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

/** 订阅一个宿主事件；`event` 变了才重新订阅。 */
export function useHostEvent<T>(event: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void listen<T>(event, (payload) => handlerRef.current(payload.payload))
      .then((un) => {
        if (cancelled) un();
        else unlisten = un;
      })
      .catch((error: unknown) => {
        console.warn(`[host-event] subscribe ${event} failed`, error);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event]);
}

/** `md-sync:changed`：宿主同步完成后广播（载荷 `MdSyncReport`）。 */
export const MD_SYNC_CHANGED_EVENT = "md-sync:changed";
