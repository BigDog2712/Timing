/**
 * Timing — 独立设置窗（label = settings）
 * -----------------------------------------------------------------------------
 * 后端 open_settings_window 以 `decorations:false / transparent:true / visible:false`
 * 创建 392×660 单例窗口（ADR-009 §2）。本组件是该窗的根：
 *   1. 自绘标题栏随 SettingsPanel（variant="window"）；
 *   2. 首帧就绪后自行 show（K-18 防白闪）；
 *   3. 自订阅 theme-changed（主窗不代转，K-21）+ 首帧 theme_get/accent_get。
 * 尺寸/透明底由 html[data-window="settings"] 与 .settings--window 承载（见 CSS）。
 */
import { useEffect } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { closeCurrentWindow, showCurrentWindowOnReady } from '../../lib/window';
import { themeActions } from '../../services/themeActions';
import { useThemeStore } from '../../stores/themeStore';
import { IPC_EVENTS } from '../../types/domain';
import type { ThemeChangedPayload } from '../../types/domain';
import { SettingsPanel } from './SettingsPanel';

export function SettingsWindow() {
  /* 主题：本窗自订阅广播 */
  useTauriEvent<ThemeChangedPayload>(IPC_EVENTS.themeChanged, (payload) => {
    useThemeStore.getState().apply(payload.mode, payload.accents);
  });

  /* 首帧读权威主题 + 四色 */
  useEffect(() => {
    let cancelled = false;
    void themeActions.init().catch(() => {
      if (!cancelled) useThemeStore.getState().markLoaded();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* 首帧就绪后显示窗口（防白闪；cleanup 取消未执行的 rAF/定时器） */
  useEffect(() => showCurrentWindowOnReady(), []);

  return (
    <div className="win">
      <SettingsPanel variant="window" onRequestClose={() => void closeCurrentWindow()} />
    </div>
  );
}
