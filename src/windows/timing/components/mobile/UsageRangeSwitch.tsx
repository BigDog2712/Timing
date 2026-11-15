/**
 * [0.13.2] 统计页的范围切换（单日 / 近 7 天）。
 *
 * 市面上的屏幕时间产品第一层永远是范围：Digital Wellbeing 有「日 / 周 / 月」，
 * 屏幕使用时间有「日 / 周」。这一页能拿到的明细只有 7 天（系统限制），所以范围只给两档，
 * **不摆一个点不动的「本月」**。
 */
export type UsageMode = 'day' | 'week';

const OPTIONS: readonly { mode: UsageMode; label: string }[] = [
  { mode: 'day', label: '单日' },
  { mode: 'week', label: '近 7 天' },
];

interface Props {
  mode: UsageMode;
  onChange: (mode: UsageMode) => void;
}

export function UsageRangeSwitch({ mode, onChange }: Props) {
  return (
    <div className="m-usage-range" role="group" aria-label="统计范围">
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className="m-usage-range__item"
          data-active={mode === option.mode || undefined}
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
