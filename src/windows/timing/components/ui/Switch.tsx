/**
 * Timing — 开关 Switch（settings-panel.md §3.2）
 * -----------------------------------------------------------------------------
 * 轨道 40x22 圆角 pill；On 态底 --accent（设置面板唯一强调色来源）；滑块位移用
 * transform（禁 left，遵守动效属性白名单）。role="switch" + aria-checked。
 */
import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  const id = useId();
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      data-on={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" aria-hidden />
    </button>
  );
}
