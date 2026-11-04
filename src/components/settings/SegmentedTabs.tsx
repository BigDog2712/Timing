/**
 * TickBar — 分段控件 SegmentedTabs（DESIGN-V0.2.0.md §4.4）
 * -----------------------------------------------------------------------------
 * 取代三个独立页签按钮：role="tablist" + 段等宽；←→ 切段；选中段 --bg-seg-on。
 */
import type { KeyboardEvent } from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
}

interface SegmentedTabsProps<T extends string> {
  tabs: readonly TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}

export function SegmentedTabs<T extends string>({ tabs, active, onChange, ariaLabel }: SegmentedTabsProps<T>) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.id === active);
    if (idx < 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(tabs[(idx + 1) % tabs.length].id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(tabs[(idx - 1 + tabs.length) % tabs.length].id);
    }
  };

  return (
    <div className="seg" role="tablist" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={on}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={on ? 0 : -1}
            className="seg__item"
            data-on={on ? 'true' : 'false'}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
