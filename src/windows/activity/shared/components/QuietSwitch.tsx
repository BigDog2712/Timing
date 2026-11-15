interface Props {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (nextChecked: boolean) => void;
}

export default function QuietSwitch({
  checked,
  disabled = false,
  ariaLabel,
  onChange,
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`at-switch ${checked ? "at-switch-checked" : ""}`.trim()}
    >
      <span className={`at-switch-thumb ${checked ? "at-switch-thumb-checked" : ""}`.trim()} />
    </button>
  );
}
