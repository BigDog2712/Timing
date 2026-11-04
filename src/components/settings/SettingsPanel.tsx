/**
 * TickBar — 设置面板 SettingsPanel（settings-panel.md · V0.2.0 三页签改造）
 * -----------------------------------------------------------------------------
 * 四页签：外观配色（ThemePicker，含 V0.3.3 迁入的「显示」卡）/ 插件 / 同步 / 通用。
 * [V0.3.4] 日记页签随日记模块整体下架（ADR-023）；「扩展」改名「插件」。
 * [V0.4.0] 新增「同步」页签：md-sync 插件的落点配置与运行状态。
 * 结构：标题栏 + 分段页签 + 内容区（滚动）+ 底栏（所有更改即时生效 + neutral「完成」）。
 * 走命令：theme_* / accent_* / get_settings / update_settings / set_autostart。
 */
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { PluginsTab } from './PluginsTab';
import { GeneralTab } from './GeneralTab';
import { MdSyncTab } from './MdSyncTab';
import { SegmentedTabs, type TabDef } from './SegmentedTabs';
import { ThemePicker } from './ThemePicker';

type TabId = 'look' | 'plugins' | 'sync' | 'gen';

const TABS: readonly TabDef<TabId>[] = [
  { id: 'look', label: '外观配色' },
  { id: 'plugins', label: '插件' },
  { id: 'sync', label: '同步' },
  { id: 'gen', label: '通用' },
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
        {/* [V0.3.9] 用户口径：右上角不再放关闭 ×——「完成」与 Esc 已够，
            独立设置窗那侧的标题栏也只留拖动区（窗口无系统边框）。 */}
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
        {tab === 'plugins' && <PluginsTab />}
        {tab === 'sync' && <MdSyncTab />}
        {tab === 'gen' && <GeneralTab />}
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
