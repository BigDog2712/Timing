/**
 * TickBar — 设置 · 通用页签（settings-panel.md §3.1「通用」）
 * -----------------------------------------------------------------------------
 * 行骨架统一「左标签 + 右控件」（全页一条竖向对齐轴）。
 * 开机自启 / 保持置顶 / 感知壁纸三开关 + 全局快捷键 [P1] 占位（禁用编辑，避免假交互）。
 */
import { useState } from 'react';
import { KeyboardIcon, PencilIcon, iconStroke } from '../../lib/icons';
import { errorText } from '../../services/ipc';
import { settingsActions } from '../../services/settingsActions';
import { useSettingsStore } from '../../stores/settingsStore';
import { Switch } from '../ui/Switch';

const SHORTCUT_ROWS = [
  { key: 'toggleWindow', label: '显示 / 隐藏', accel: 'Ctrl+Alt+T' },
  { key: 'startPause', label: '开始 / 暂停', accel: 'Ctrl+Alt+S' },
  { key: 'stop', label: '结束', accel: 'Ctrl+Alt+E' },
  { key: 'newItem', label: '新建事项', accel: 'Ctrl+Alt+N' },
] as const;

export function GeneralTab() {
  const settings = useSettingsStore((s) => s.settings);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="setting-group">
      <div className="setting-row">
        <span className="setting-row__label">开机自启</span>
        <Switch
          label="开机自启"
          checked={settings.autostartEnabled}
          onChange={(v) => void run(() => settingsActions.setAutostart(v))}
        />
      </div>
      <div className="setting-row">
        <span className="setting-row__label">保持窗口置顶</span>
        <Switch
          label="保持窗口置顶"
          checked={settings.alwaysOnTop}
          onChange={(v) => void run(() => settingsActions.setAlwaysOnTop(v))}
        />
      </div>
      <div className="setting-row">
        <span className="setting-row__label">感知壁纸自动提高不透明度</span>
        <Switch
          label="感知壁纸自动提高不透明度"
          checked={settings.opacityEnabled}
          onChange={(v) => void run(() => settingsActions.setOpacityEnabled(v))}
        />
      </div>
      <div className="setting-row">
        <span className="setting-row__label">
          倒计时到点自动结束并保存
          <span className="setting-row__hint">关闭则仅通知</span>
        </span>
        <Switch
          label="倒计时到点自动结束并保存"
          checked={settings.countdownAutoEnd}
          onChange={(v) => void run(() => settingsActions.setCountdownAutoEnd(v))}
        />
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      <div className="settings__divider" aria-hidden />

      <div className="setting-group">
        <h3 className="setting-group__title">
          <KeyboardIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          <span>全局快捷键</span>
          <span className="pill-tag">P1</span>
        </h3>
        {SHORTCUT_ROWS.map((row) => (
          <div className="shortcut-row" key={row.key}>
            <span className="shortcut-row__label">{row.label}</span>
            <span className="shortcut-row__accel">{row.accel}</span>
            <button type="button" className="btn btn--ghost" disabled title="v2 支持自定义快捷键">
              <PencilIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              编辑
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
