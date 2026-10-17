/**
 * TickBar — 设置面板 SettingsPanel（settings-panel.md · V0.2.0 三页签改造）
 * -----------------------------------------------------------------------------
 * 三页签：外观配色（ThemePicker）/ 扩展（占位空态）/ 通用（开关 + 快捷键）。
 * 结构：标题栏 + 分段页签 + 内容区（滚动）+ 底栏（所有更改即时生效 + neutral「完成」）。
 * 走命令：theme_* / accent_* / get_settings / update_settings / set_autostart。
 */
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { XIcon, iconStroke } from '../../lib/icons';
import { useUiStore } from '../../stores/uiStore';
import { ExtensionsTab } from './ExtensionsTab';
import { GeneralTab } from './GeneralTab';
import { DiaryTab } from './DiaryTab';
import { SegmentedTabs, type TabDef } from './SegmentedTabs';
import { ThemePicker } from './ThemePicker';

type TabId = 'look' | 'ext' | 'gen' | 'diary';

const TABS: readonly TabDef<TabId>[] = [
  { id: 'look', label: '外观配色' },
  { id: 'ext', label: '扩展' },
  { id: 'gen', label: '通用' },
  { id: 'diary', label: '日记' },
];

interface SettingsPanelProps {
  /** panel = 主窗内浮层（默认）；window = 独立设置窗（decorations:false，需自绘标题栏 + 拖动区） */
  variant?: 'panel' | 'window';
  /** 关闭动作；缺省 = 关闭主窗面板（uiStore.closePanel） */
  onRequestClose?: () => void;
}

export function SettingsPanel({ variant = 'panel', onRequestClose }: SettingsPanelProps) {
  const closePanel = useUiStore((s) => s.closePanel);
  const requestClose = onRequestClose ?? closePanel;
  const [tab, setTab] = useState<TabId>('look');
  const isWindow = variant === 'window';

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
    }
  };

  return (
    <div
      className={isWindow ? 'settings settings--window' : 'settings'}
      role="dialog"
      aria-label="设置"
      onKeyDown={handleKeyDown}
    >
      <header className="settings__bar" data-tauri-drag-region={isWindow ? '' : undefined}>
        <h2 className="settings__title">设置</h2>
        <button type="button" className="settings__close" aria-label="关闭设置" onClick={requestClose}>
          <XIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
      </header>

      <div className="settings__tabs">
        <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="设置分类" />
      </div>

      <div
        className="settings__content"
        role="tabpanel"
        id={`tabpanel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'look' && <ThemePicker />}
        {tab === 'ext' && <ExtensionsTab />}
        {tab === 'gen' && <GeneralTab />}
        {tab === 'diary' && <DiaryTab />}
      </div>

      <footer className="settings__foot">
        <span className="settings__foot-hint">所有更改即时生效</span>
        <button type="button" className="btn btn--neutral" onClick={requestClose}>
          完成
        </button>
      </footer>
    </div>
  );
}
