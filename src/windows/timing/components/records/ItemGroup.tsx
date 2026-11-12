/**
 * Timing — 按事项聚合分组（records-panel.md §1 / §2）
 * -----------------------------------------------------------------------------
 * 头部：clock 图标 + 事项名 + 聚合时长 + chevron（展开旋转 90°）。
 * 展开后列出该事项的明细记录（RecordRow）。
 */
import { useState } from 'react';
import { ChevronRightIcon, ClockIcon, iconStroke } from '../../lib/icons';
import { formatDuration } from '../../lib/format';
import type { RecordGroup } from '../../hooks/useRecordsData';
import type { Item } from '../../types/domain';
import { RecordRow } from './RecordRow';

interface ItemGroupProps {
  group: RecordGroup;
  items: Item[];
  onReassign: (recordId: number, itemId: number) => void;
  onDelete: (recordId: number) => void;
}

export function ItemGroup({ group, items, onReassign, onDelete }: ItemGroupProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="group">
      <button
        type="button"
        className="group__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ClockIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        <span className="group__name">{group.name}</span>
        <span className="group__total timer-digits" data-hours={group.totalSec >= 3600 ? 'true' : 'false'}>
          {formatDuration(group.totalSec)}
        </span>
        <ChevronRightIcon
          size={20}
          strokeWidth={iconStroke(20)}
          className="group__chev"
          data-open={open ? 'true' : 'false'}
          aria-hidden
        />
      </button>

      {open && (
        <div className="group__rows">
          {group.records.length === 0 ? (
            <p className="group__empty">该事项在此范围内没有明细记录</p>
          ) : (
            group.records.map((record) => (
              <RecordRow
                key={record.id}
                record={record}
                items={items}
                onReassign={onReassign}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
