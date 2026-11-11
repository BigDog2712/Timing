/**
 * 主界面设置 · G1 高亮颜色卡（[0.12.1] T04：移植宿主 `HighlightColorRow`）
 * -----------------------------------------------------------------------------
 * 高亮颜色写的是**参考设置** `timing.highlight_color`（`ReferenceSettings.highlightColor`），
 * 参与业务判定（托盘双击时小条按此色闪三下）。所以它不是 localStorage 偏好，必须走宿主的
 * `get_reference_settings` / `update_reference_settings`。
 *
 * 合法性与兜底：`#RGB` / `#RRGGBB`（与 `src/services/highlightActions.ts::isValidHighlightColor`
 * 同一口径，复制一份是因为分析窗读不到 services，L9）；读不到时兜底 `#4DA3E8`，与 Rust
 * `ReferenceSettings::default().highlight_color` 同值。**非法值不落库**，只在卡底报错。
 */
import { Highlighter } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import QuietColorField from "../../../../shared/components/QuietColorField";
import type { ColorDisplayFormat } from "../../../../shared/lib/colorFormatting";
import {
  getReferenceSettings,
  updateReferenceSettings,
} from "../../../../platform/desktop/hostSettingsGateway.ts";
import SettingsPanelHeader from "../SettingsPanelHeader";
import { SettingsPreferenceRow } from "../SettingsPreferenceLayout";

const STROKE = 1.6;
const FALLBACK_HIGHLIGHT = "#4DA3E8";
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface HostHighlightCardProps {
  /** 锚点 id（G3 的 `#s-highlight`） */
  id?: string;
}

export default function HostHighlightCard({ id }: HostHighlightCardProps) {
  const [hex, setHex] = useState<string | null>(null);
  const [format, setFormat] = useState<ColorDisplayFormat>("hex");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const reference = await getReferenceSettings();
      setHex(reference.highlightColor);
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const commit = (raw: string) => {
    const next = raw.trim().toUpperCase();
    if (!HEX_RE.test(next)) {
      setError("颜色格式应为 #RGB 或 #RRGGBB");
      return;
    }
    if (next === (hex ?? FALLBACK_HIGHLIGHT).toUpperCase()) return;
    setBusy(true);
    setError(null);
    void updateReferenceSettings({ highlightColor: next })
      .then((reference) => setHex(reference.highlightColor))
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="qp-panel p-5 md:p-6" id={id}>
      <SettingsPanelHeader
        icon={<Highlighter size={16} strokeWidth={STROKE} className="text-[var(--qp-accent-default)]" />}
        title="高亮颜色"
      />
      <div className="mt-4">
        <SettingsPreferenceRow
          title="托盘双击定位时的高亮色"
          hint="托盘双击会把悬浮条按这个颜色闪三下"
        >
          <span className="inline-flex items-center gap-2">
            <QuietColorField
              color={hex ?? FALLBACK_HIGHLIGHT}
              format={format}
              disabled={busy}
              presentation="swatch"
              title="选择高亮颜色"
              onChange={commit}
              onFormatChange={setFormat}
              resetAction={{ label: "恢复默认", onReset: () => commit(FALLBACK_HIGHLIGHT) }}
            />
            <span className="qp-text-caption text-[var(--qp-text-tertiary)]">
              {hex ?? FALLBACK_HIGHLIGHT}
            </span>
          </span>
        </SettingsPreferenceRow>
        {error ? (
          <p className="mt-2 qp-text-caption text-[var(--qp-danger)]" role="alert">{error}</p>
        ) : null}
      </div>
    </section>
  );
}
