/**
 * Timing — 记录面板范围切换（今天 / 本周，records-panel.md §1）
 * -----------------------------------------------------------------------------
 * 选中态用 2px 下划线 --accent（本页唯一强调色），比背景块更克制。
 */
import type { RecordsRange } from '../../lib/time';

interface DayWeekTabsProps {
  value: RecordsRange;
  onChange: (range: RecordsRange) => void;
}

const TABS: { key: RecordsRange; label: string }[] = [
  { key: 'day', label: '今天' },
  { key: 'week', label: '本周' },
];

export function DayWeekTabs({ value, onChange }: DayWeekTabsProps) {
  return (
    <div className="records__tabs" role="tablist" aria-label="记录范围">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          className="tab"
          aria-selected={value === tab.key}
          data-active={value === tab.key ? 'true' : 'false'}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {value === tab.key && <span className="tab__underline" aria-hidden />}
        </button>
      ))}
    </div>
  );
}
