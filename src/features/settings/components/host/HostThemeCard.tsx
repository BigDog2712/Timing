/**
 * 主界面设置 · G3「主题与主色」卡（[0.12.1] T04：从宿主的 `ThemePicker` 移植）
 * -----------------------------------------------------------------------------
 * 搬的是**功能**，不是文件：深浅两选 + 四色 + 恢复默认 + 错误文案，一项不少。
 * 数据面从「宿主 store + `services/themeActions`」换成
 * `platform/desktop/hostSettingsGateway.ts`（分析窗读不到 `src/services/**`，L9）。
 *
 * 为什么写完不用自己再广播：宿主 `theme_set` / `accent_set` 成功后会 `app.emit` `theme-changed`
 * （K-21，全窗），药丸与迷你窗各自订阅。**不新增事件、不轮询**——本卡只负责「写对 + 报错」。
 *
 * 图标用 `lucide-react`（分析窗可直接依赖），**不用** `src/lib/icons`（那是主窗目录，L9 禁区），
 * 所以线宽按 1.6 自己写，与主窗 `iconStroke()` 同观感。
 */
import { Check, Monitor, Moon, Palette, RotateCcw, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import QuietButton from "../../../../shared/components/QuietButton";
import QuietColorField from "../../../../shared/components/QuietColorField";
import type { ColorDisplayFormat } from "../../../../shared/lib/colorFormatting";
import type { ThemeMode } from "../../../../shared/settings/appSettings.ts";
import {
  DEFAULT_HOST_ACCENTS,
  accentGet,
  accentSet,
  themeGet,
  themeSet,
  type HostAccentKey,
  type HostAccents,
} from "../../../../platform/desktop/hostSettingsGateway.ts";
import SettingsPanelHeader from "../SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "../SettingsPreferenceLayout";

const STROKE = 1.6;

const THEME_OPTIONS: readonly { id: ThemeMode; label: string; icon: typeof Moon }[] = [
  { id: "dark", label: "深色", icon: Moon },
  { id: "light", label: "浅色", icon: Sun },
  { id: "system", label: "跟随系统", icon: Monitor },
];

const ACCENT_ROWS: readonly { key: HostAccentKey; label: string }[] = [
  { key: "running", label: "计时中" },
  { key: "warn", label: "提醒" },
  { key: "done", label: "完成" },
  { key: "bar", label: "小条底色" },
];

/** `bar` 未配置（跟随主题令牌）时色点显示的兜底底色，与宿主 `ACCENT_BAR_DEFAULT_HEX` 同值。 */
const BAR_FALLBACK_HEX = "#0E0F12";

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface HostThemeCardProps {
  /** 锚点 id（G3 的 `#s-theme`） */
  id?: string;
}

export default function HostThemeCard({ id }: HostThemeCardProps) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [accents, setAccents] = useState<HostAccents | null>(null);
  const [format, setFormat] = useState<ColorDisplayFormat>("hex");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* 首帧读一次（宿主是唯一真相）。读不到就留着空态 + 错误条，不假装成功。 */
  const load = useCallback(async () => {
    try {
      const [nextMode, nextAccents] = await Promise.all([themeGet(), accentGet()]);
      setMode(nextMode);
      setAccents(nextAccents);
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = (action: () => Promise<HostAccents>) => {
    setBusy(true);
    setError(null);
    void action()
      .then((next) => setAccents(next))
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(false));
  };

  const pickTheme = (next: ThemeMode) => {
    if (next === mode || busy) return;
    const previous = mode;
    setMode(next); // 即时反馈：不等往返
    setBusy(true);
    setError(null);
    void themeSet(next)
      .then((applied) => setMode(applied))
      .catch((err: unknown) => { setMode(previous); setError(message(err)); })
      .finally(() => setBusy(false));
  };

  const pickAccent = (key: HostAccentKey, value: string | null) => {
    if (value !== null && !HEX_RE.test(value)) {
      setError("颜色格式应为 #RGB 或 #RRGGBB");
      return;
    }
    const patch: Partial<HostAccents> =
      key === "bar" ? { bar: value }
        : key === "running" ? { running: value as string }
          : key === "warn" ? { warn: value as string }
            : { done: value as string };
    run(() => accentSet(patch));
  };

  const hexOf = (key: HostAccentKey): string => {
    const value = accents?.[key];
    if (value) return value;
    const fallback = DEFAULT_HOST_ACCENTS[key];
    return fallback ?? BAR_FALLBACK_HEX;
  };

  return (
    <section className="qp-panel p-5 md:p-6" id={id}>
      <SettingsPanelHeader
        icon={<Palette size={16} strokeWidth={STROKE} className="text-[var(--qp-accent-default)]" />}
        title="主题与主色"
      />
      <div className="mt-4 grid gap-4">
        <SettingsPreferenceGroup title="主题">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="主题模式">
            {THEME_OPTIONS.map(({ id: themeId, label, icon: Icon }) => {
              const on = themeId === mode;
              return (
                <button
                  key={themeId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={busy}
                  onClick={() => pickTheme(themeId)}
                  className={`flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 qp-text-body disabled:opacity-50 ${
                    on
                      ? "border-[var(--qp-accent-default)] text-[var(--qp-text-primary)]"
                      : "border-[var(--qp-border-subtle)] text-[var(--qp-text-secondary)]"
                  }`}
                >
                  <Icon size={14} strokeWidth={STROKE} aria-hidden />
                  {label}
                  {on ? <Check size={13} strokeWidth={STROKE} aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </SettingsPreferenceGroup>

        <SettingsPreferenceGroup
          title="配色"
          headerAside={(
            <QuietButton
              size="compact"
              disabled={busy}
              onClick={() => run(() => accentSet(DEFAULT_HOST_ACCENTS))}
            >
              <span className="inline-flex items-center gap-1.5">
                <RotateCcw size={13} strokeWidth={STROKE} aria-hidden />
                恢复默认配色
              </span>
            </QuietButton>
          )}
        >
          {ACCENT_ROWS.map(({ key, label }) => (
            <SettingsPreferenceRow key={key} title={label}>
              <span className="inline-flex items-center gap-2">
                <QuietColorField
                  color={hexOf(key)}
                  format={format}
                  disabled={busy}
                  presentation="swatch"
                  title={`选择${label}颜色`}
                  onChange={(nextColor) => pickAccent(key, nextColor)}
                  onFormatChange={setFormat}
                  resetAction={{
                    label: "恢复默认",
                    onReset: () => pickAccent(key, DEFAULT_HOST_ACCENTS[key]),
                  }}
                />
                <span className="qp-text-caption text-[var(--qp-text-tertiary)]">{hexOf(key)}</span>
              </span>
            </SettingsPreferenceRow>
          ))}
        </SettingsPreferenceGroup>

        {error ? (
          <p className="qp-text-caption text-[var(--qp-danger)]" role="alert">{error}</p>
        ) : null}
      </div>
    </section>
  );
}
