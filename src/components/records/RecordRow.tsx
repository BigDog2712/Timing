/**
 * Timing — 单条记录行（records-panel.md §1 / §3.3，AC-17）
 * -----------------------------------------------------------------------------
 * 展示「开始 - 结束」+ 时长（等宽右对齐）；hover 出现「改归属」「删除」。
 * 改归属 → update_record（内联 select）；删除 → delete_record。
 */
import { useState } from 'react';
import { formatRange, formatDuration, hasHours } from '../../lib/format';
import { PencilIcon, TrashIcon, iconStroke } from '../../lib/icons';
import type { Item, TimeRecord } from '../../types/domain';

interface RecordRowProps {
  record: TimeRecord;
  items: Item[];
  onReassign: (recordId: number, itemId: number) => void;
  onDelete: (recordId: number) => void;
}

export function RecordRow({ record, items, onReassign, onDelete }: RecordRowProps) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="row" data-editing={editing ? 'true' : 'false'}>
      <span className="row__range">{formatRange(record.startedAt, record.endedAt)}</span>
      <span className="row__dur timer-digits" data-hours={hasHours(record.accumulatedSec) ? 'true' : 'false'}>
        {formatDuration(record.accumulatedSec)}
      </span>
      <div className="row__actions">
        <button
          type="button"
          className="row__btn"
          aria-label="改归属事项"
          aria-pressed={editing}
          onClick={() => setEditing((v) => !v)}
        >
          <PencilIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
        <button
          type="button"
          className="row__btn row__btn--danger"
          aria-label="删除这条记录"
          onClick={() => onDelete(record.id)}
        >
          <TrashIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
      </div>

      {editing && (
        <div className="row__edit">
          <label className="row__edit-label" htmlFor={`reassign-${record.id}`}>
            归属事项
          </label>
          <select
            id={`reassign-${record.id}`}
            className="row__select"
            value={record.itemId}
            onChange={(e) => {
              onReassign(record.id, Number(e.target.value));
              setEditing(false);
            }}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
