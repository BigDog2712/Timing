/**
 * TickBar — Tauri 事件订阅 Hook（K-8：unlisten 必须在 cleanup 调用）
 * -----------------------------------------------------------------------------
 * 组件内禁止直接 `listen`；一律经本 Hook（内部走 services/ipc 的 onIpcEvent）。
 * handler 通过 ref 转发，保证订阅只随 event 名重建一次，避免因内联 handler 反复重订阅。
 */
import { useEffect, useRef } from 'react';
import { onIpcEvent } from '../services/ipc';

export function useTauriEvent<T>(event: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void onIpcEvent<T>(event, (payload) => handlerRef.current(payload)).then((un) => {
      if (cancelled) un();
      else unlisten = un;
    });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [event]);
}
