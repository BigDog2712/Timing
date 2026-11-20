/**
 * 记下「最近切到过的前台应用」（0.13.x：新建事项可绑定应用）。
 *
 * 数据源与 `useAppBindingAutoTimer` 相同：追踪引擎在**前台真的变了**时广播
 * `active-window-changed`（每秒轮询里只有变化才发），这里只取进程名写进
 * `useRecentAppsStore`。订阅之后再主动查一次当前前台，补上冷启动时错过的第一帧
 * （开机自启 / 先开应用再开 Timing）——与自动接管的冷启动补刀同一个理由。
 *
 * 只做记录：不判断绑定、不发意图。`normalizeAppKey` / 自家进程过滤都在 store 里。
 */
import { useEffect, useRef } from 'react';

import { ACTIVE_WINDOW_CHANGED_EVENT, readActiveWindowExe } from '../../shared/hostEvents.ts';
import { ipc } from '../services/ipc';
import { useRecentAppsStore } from '../stores/recentApps';
import { useTauriEvent } from './useTauriEvent';

export function useForegroundAppLog(): void {
  useTauriEvent<unknown>(ACTIVE_WINDOW_CHANGED_EVENT, (payload) => {
    const exeName = readActiveWindowExe(payload);
    if (exeName) useRecentAppsStore.getState().note(exeName);
  });

  const queriedRef = useRef(false);
  useEffect(() => {
    if (queriedRef.current) return;
    queriedRef.current = true;
    void (async () => {
      try {
        const window = await ipc.getForegroundWindow();
        if (window?.exeName) useRecentAppsStore.getState().note(window.exeName);
      } catch {
        /* 启动期桌面壳 / 锁屏 / 追踪还没起：查不到是常态，不是错误 */
      }
    })();
  }, []);
}