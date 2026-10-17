/**
 * TickBar — 主题 / 配色 ThemePicker（theme-picker.md · V0.2.0 新增）
 * -----------------------------------------------------------------------------
 * 两张卡片：主题卡（深色 / 浅色 / 跟随系统）+ 配色卡（四色取色行 + 恢复默认）。
 * 切换即时反馈：先本地 apply（所见即所得），再落库（theme_set / accent_set）。
 * 对应命令 theme_get/set · accent_get/set | 事件 theme-changed。
 */
import { useState } from 'react';
import { CheckIcon, MonitorIcon, MoonIcon, RotateCcwIcon, SunIcon, iconStroke } from '../../lib/icons';
import type { AccentKey } from '../../lib/theme';
import { errorText } from '../../services/ipc';
import { themeActions } from '../../services/themeActions';
import { useThemeStore } from '../../stores/themeStore';
import type { AccentColors, ThemeMode } from '../../types/domain';
import { SwatchRow } from './SwatchRow';

interface ThemeCardDef {
  id: ThemeMode;
  label: string;
  Icon: typeof MoonIcon;
}

const THEME_CARDS: readonly ThemeCardDef[] = [
  { id: 'dark', label: '深色', Icon: MoonIcon },
  { id: 'light', label: '浅色', Icon: SunIcon },
  { id: 'system', label: '跟随系统', Icon: MonitorIcon },
];

const SWATCHES: readonly { role: AccentKey; label: string }[] = [
  { role: 'running', label: '计时中' },
  { role: 'warn', label: '提醒' },
  { role: 'done', label: '完成' },
  { role: 'bar', label: '小条底色' },
];

export function ThemePicker() {
  const mode = useThemeStore((s) => s.mode);
  const resolved = useThemeStore((s) => s.resolved);
  const accents = useThemeStore((s) => s.accents);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const pickTheme = (next: ThemeMode) => {
    if (next === mode) return;
    useThemeStore.getState().setLocalMode(next); // 即时反馈
    void run(() => themeActions.setMode(next));
  };

  const pickColor = (key: AccentKey, value: string | null) => {
    const next: AccentColors = { ...accents };
    if (key === 'bar') next.bar = value;
    else next[key] = value as string;
    useThemeStore.getState().setLocalAccents(next);
    void run(() => themeActions.setAccent(key, value));
  };

  return (
    <div className="picker">
      <section className="card">
        <h3 className="card__title">主题</h3>
        <div className="theme-cards" role="radiogroup" aria-label="主题">
          {THEME_CARDS.map(({ id, label, Icon }) => {
            const on = id === mode;
            const preview = id === 'system' ? resolved : id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                className="theme-card"
                data-on={on ? 'true' : 'false'}
                disabled={busy}
                onClick={() => pickTheme(id)}
              >
                <span className="theme-card__preview" data-preview={preview}>
                  <span className="theme-card__ring" />
                  <span className="theme-card__bar" />
                </span>
                <span className="theme-card__label">
                  <Icon size={16} strokeWidth={iconStroke(16)} aria-hidden />
                  {label}
                </span>
                {on && <CheckIcon size={16} strokeWidth={iconStroke(16)} className="theme-card__check" aria-hidden />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h3 className="card__title">配色</h3>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy}
            onClick={() => void run(() => themeActions.resetAccents())}
          >
            <RotateCcwIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            恢复默认配色
          </button>
        </div>
        <div className="swatches">
          {SWATCHES.map(({ role, label }) => (
            <SwatchRow key={role} role={role} label={label} colors={accents} disabled={busy} onChange={pickColor} />
          ))}
        </div>
      </section>

      {error && (
        <p className="picker__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
