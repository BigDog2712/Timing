/**
 * Timing — 设置 · 配色卡里的「高亮颜色」行（V0.3.5 从「显示」卡合并进来）
 * -----------------------------------------------------------------------------
 * 高亮颜色本质是一个颜色，和四个主题色同属「配色」，所以放同一张卡、同一套行形制
 * （`.swatch`：色点 + 名称 + 弹性空白 + hex 胶囊），用户不用在两处找颜色设置。
 *
 * 与主题色（`SwatchRow`，走 `theme_set` / `accent_set`）的区别只在存储：
 * 高亮色是**参考设置** `timing.highlight_color`（`ReferenceSettings.highlightColor`），
 * 托盘双击时小条按此色闪三下（`services/highlightActions`）。
 * 因此这里单独成组件，但复用 `.swatch` 的样式与交互：点色点开原生取色器，hex 可直接改。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronRightIcon, iconStroke } from '../../lib/icons';
import { errorText } from '../../services/ipc';
import { isValidHighlightColor } from '../../services/highlightActions';
import { settingsActions } from '../../services/settingsActions';
import { useSettingsStore } from '../../stores/settingsStore';

/** 与后端 `ReferenceSettings::default().highlight_color` 同值（读失败时兜底） */
const FALLBACK_HIGHLIGHT = '#4DA3E8';

interface HighlightColorRowProps {
  disabled?: boolean;
  /** IPC 失败上抛给配色卡的错误条（与主题色共用一条提示） */
  onError: (message: string | null) => void;
}

export function HighlightColorRow({ disabled = false, onError }: HighlightColorRowProps) {
  const referenceSettings = useSettingsStore((s) => s.referenceSettings);

  /* 首帧没读到就先拉一次，避免色块闪现出厂色（同 V0.3.1 的兜底） */
  useEffect(() => {
    if (referenceSettings) return;
    void useSettingsStore
      .getState()
      .reloadReference()
      .catch(() => undefined);
  }, [referenceSettings]);

  const hex = referenceSettings?.highlightColor ?? FALLBACK_HIGHLIGHT;
  const [draft, setDraft] = useState(hex);
  const [invalid, setInvalid] = useState(false);
  const nativeRef = useRef<HTMLInputElement>(null);

  /* 外部值变了（保存成功 / 另一窗口改过）就同步草稿，并清掉错误态 */
  useEffect(() => {
    setDraft(hex);
    setInvalid(false);
  }, [hex]);

  const commit = (raw: string) => {
    const next = raw.trim().toUpperCase();
    if (!isValidHighlightColor(next)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next === hex.toUpperCase()) return;
    onError(null);
    void settingsActions
      .updateReferenceSettings({ highlightColor: next })
      .catch((err) => onError(errorText(err)));
  };

  return (
    <div className="swatch" data-invalid={invalid ? 'true' : 'false'}>
      <button
        type="button"
        className="swatch__dot"
        style={{ background: hex }}
        disabled={disabled}
        onClick={() => nativeRef.current?.click()}
        aria-label="选择高亮颜色"
      >
        <input
          ref={nativeRef}
          type="color"
          className="swatch__native"
          value={hex}
          tabIndex={-1}
          aria-hidden
          onChange={(e) => commit(e.target.value)}
        />
      </button>
      <span className="swatch__name">高亮颜色</span>
      <span className="swatch__spacer" />
      <input
        className="swatch__hex"
        value={draft}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={invalid}
        aria-label="高亮颜色值"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          }
        }}
      />
      <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} className="swatch__chev" aria-hidden />
      {invalid && (
        <p className="swatch__error" role="alert">
          颜色格式应为 #RGB 或 #RRGGBB
        </p>
      )}
    </div>
  );
}
