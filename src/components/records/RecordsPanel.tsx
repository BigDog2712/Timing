/**
 * TickBar — 记录汇总面板 RecordsPanel（records-panel.md，AC-16 / AC-17 / AC-18）
 * -----------------------------------------------------------------------------
 * 命令：stats_summary / list_records / update_record / delete_record。
 * 5 态：Loading（静态骨架）/ Error（重试）/ Empty（引导文案）/ Populated / Edge（滚动）。
 */
import { useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useRecordsData } from '../../hooks/useRecordsData';
import type { RecordsRange } from '../../lib/time';
import { AlertIcon, EmptyDotIcon, iconStroke } from '../../lib/icons';
import { recordApi } from '../../services/api';
import { useItemStore } from '../../stores/itemStore';
import { useUiStore } from '../../stores/uiStore';
import { DayWeekTabs } from './DayWeekTabs';
import { ItemGroup } from './ItemGroup';
import { TimerDisplay } from '../pill/TimerDisplay';
import { useHoverClose } from '../../hooks/useHoverClose';

const SKELETON_ROWS = [0, 1, 2];

export function RecordsPanel() {
  const [range, setRange] = useState<RecordsRange>('day');
  const { loading, error, totalSec, groups, reload } = useRecordsData(range);
  const items = useItemStore((s) => s.items);
  const closePanel = useUiStore((s) => s.closePanel);

  /* [V0.2.7] 指针离开面板即自动收起（小条触发的浮层统一行为） */
  useHoverClose(closePanel);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
    }
  };

  const handleReassign = useCallback(
    async (recordId: number, itemId: number) => {
      try {
        await recordApi.update(recordId, { itemId });
      } finally {
        reload();
      }
    },
    [reload],
  );

  const handleDelete = useCallback(
    async (recordId: number) => {
      try {
        await recordApi.remove({ id: recordId });
      } finally {
        reload();
      }
    },
    [reload],
  );

  return (
    <div className="records" role="dialog" aria-label="记录汇总" onKeyDown={handleKeyDown}>
      <DayWeekTabs value={range} onChange={setRange} />

      <div className="records__total">
        <span className="records__total-label">总计</span>
        <TimerDisplay seconds={totalSec} size="lg" />
      </div>

      <div className="records__body">
        {loading && (
          <div className="records__skeleton" aria-hidden>
            {SKELETON_ROWS.map((row) => (
              <span key={row} className="skeleton-row" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="state-block" role="alert">
            <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={reload}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <div className="state-block">
            <EmptyDotIcon size={24} strokeWidth={iconStroke(24)} aria-hidden />
            <p>点左侧圆钮开始第一次计时</p>
          </div>
        )}

        {!loading &&
          !error &&
          groups.map((group) => (
            <ItemGroup
              key={group.itemId}
              group={group}
              items={items}
              onReassign={(id, itemId) => void handleReassign(id, itemId)}
              onDelete={(id) => void handleDelete(id)}
            />
          ))}
      </div>

      <p className="records__hint">
        <kbd className="kbd">ESC</kbd>
        <span>收起</span>
      </p>
    </div>
  );
}
