/**
 * TickBar — 取色行 SwatchRow（DESIGN-V0.2.0.md §4.6 / theme-picker.md §1）
 * -----------------------------------------------------------------------------
 * [色点 18 + 名 13/--ink + 弹性空白 + hex 胶囊 + 箭头]。点色点 → 原生 color input；
 * hex 胶囊可直接编辑，非法 hex 就地提示（与后端 INVALID_COLOR 呼应）。
 * bar 角色允许清空 → 跟随主题令牌。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronRightIcon, iconStroke } from '../../lib/icons';
import { accentHex, isValidHex, type AccentKey } from '../../lib/theme';
import type { AccentColors } from '../../types/domain';

interface SwatchRowProps {
  role: AccentKey;
  label: string;
  colors: AccentColors;
  disabled?: boolean;
  onChange: (key: AccentKey, value: string | null) => void;
}

export function SwatchRow({ role, label, colors, disabled = false, onChange }: SwatchRowProps) {
  const value = colors[role];
  const hex = accentHex(role, colors);
  const [draft, setDraft] = useState(hex);
  const [invalid, setInvalid] = useState(false);
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(hex);
    setInvalid(false);
  }, [hex]);

  const commit = () => {
    const v = draft.trim();
    if (v === '') {
      if (role === 'bar') {
        setInvalid(false);
        onChange(role, null);
      } else {
        setInvalid(true);
      }
      return;
    }
    if (!isValidHex(v)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(role, v.toUpperCase());
  };

  return (
    <div className="swatch" data-invalid={invalid ? 'true' : 'false'}>
      <button
        type="button"
        className="swatch__dot"
        style={{ background: hex }}
        disabled={disabled}
        onClick={() => nativeRef.current?.click()}
        aria-label={`选择「${label}」颜色`}
      >
        <input
          ref={nativeRef}
          type="color"
          className="swatch__native"
          value={hex}
          tabIndex={-1}
          aria-hidden
          onChange={(e) => onChange(role, e.target.value.toUpperCase())}
        />
      </button>
      <span className="swatch__name">{label}</span>
      <span className="swatch__spacer" />
      <input
        className="swatch__hex"
        value={draft}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={invalid}
        aria-label={`${label}颜色值`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      {role === 'bar' && value != null && (
        <button type="button" className="swatch__follow" disabled={disabled} onClick={() => onChange(role, null)}>
          跟随主题
        </button>
      )}
      <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} className="swatch__chev" aria-hidden />
      {invalid && (
        <p className="swatch__error" role="alert">
          颜色格式应为 #RGB 或 #RRGGBB
        </p>
      )}
    </div>
  );
}
