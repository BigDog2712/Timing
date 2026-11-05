/**
 * Timing — 单条记录编辑 Sheet（改归属 / 改起止 / 改备注 / 软删）
 * -----------------------------------------------------------------------------
 * 三条硬口径：
 *   1. **结束必须晚于开始**：本地先拦（`ended < started` 时给出居中提示），
 *      并且把两个时间输入框**回退成记录里的真实值**——界面不能显示一个没被保存的时间，
 *      否则用户会以为改成功了，下次打开又变回去。
 *   2. 备注 ≤500 字（与后端 `update_record` 校验同值），`maxLength` 只是第一道闸。
 *   3. 改完必须让「按事项分布」立刻变：`bumpRecords()` 自增，记录页据此重拉
 *      `stats_summary`（分布数字的唯一来源）。
 */
import { useState } from 'react';
import { formatClockTime } from '../../lib/format';
import { fromDateTimeInput, toDateTimeInput } from '../../lib/mobileTime';
import { errorText, recordApi } from '../../services/api';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useItemStore } from '../../stores/itemStore';
import { useUiStore } from '../../stores/uiStore';
import type { TimeRecord } from '../../types/domain';
import { Sheet } from './Sheet';

const NOTE_MAX_LEN = 500;

interface RecordEditSheetProps {
  record: TimeRecord;
}

export function RecordEditSheet({ record }: RecordEditSheetProps) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const bumpRecords = useMobileUiStore((s) => s.bumpRecords);
  const items = useItemStore((s) => s.items);

  /** active 记录（不该出现在记录页）没有 endedAt：用「开始 + 累计」兜一个可编辑值 */
  const fallbackEnd = record.endedAt ?? record.startedAt + record.accumulatedSec * 1000;

  const [itemId, setItemId] = useState(record.itemId);
  const [start, setStart] = useState(() => toDateTimeInput(record.startedAt));
  const [end, setEnd] = useState(() => toDateTimeInput(fallbackEnd));
  const [note, setNote] = useState(record.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resetTimes = () => {
    setStart(toDateTimeInput(record.startedAt));
    setEnd(toDateTimeInput(fallbackEnd));
  };

  const save = async () => {
    if (busy) return;
    const startMs = fromDateTimeInput(start);
    const endMs = fromDateTimeInput(end);
    if (startMs == null || endMs == null) {
      setError('时间格式不正确');
      return;
    }
    if (endMs <= startMs) {
      setError('结束时间必须晚于开始时间，已恢复原值');
      resetTimes();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await recordApi.update(record.id, {
        itemId,
        startedAt: startMs,
        endedAt: endMs,
        note: note.slice(0, NOTE_MAX_LEN),
      });
      bumpRecords();
      useUiStore.getState().setNotice({ text: '记录已更新', tone: 'info' });
      closeSheet('recordEdit');
    } catch (err) {
      /* 后端 INVALID_DURATION 也会走到这里（例如记录被并发改动）：同样回退时间框 */
      setError(errorText(err));
      resetTimes();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await recordApi.remove({ id: record.id });
      bumpRecords();
      useUiStore.getState().setNotice({ text: '记录已删除', tone: 'info' });
      closeSheet('recordEdit');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`编辑记录 · ${formatClockTime(record.startedAt)}`}
      onClose={closeSheet}
      footer={
        <div className="m-sheet__foot-row">
          <button type="button" className="m-btn m-btn--danger" disabled={busy} onClick={() => void remove()}>
            删除
          </button>
          <button type="button" className="m-btn m-btn--primary m-field--grow" disabled={busy} onClick={() => void save()}>
            保存
          </button>
        </div>
      }
    >
      <label className="m-field">
        <span className="m-field__label">归属事项</span>
        <select className="m-input" value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className="m-field">
        <span className="m-field__label">开始时间</span>
        <input
          className="m-input"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>

      <label className="m-field">
        <span className="m-field__label">结束时间</span>
        <input className="m-input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>

      <label className="m-field">
        <span className="m-field__label">备注（{note.length}/{NOTE_MAX_LEN}）</span>
        <textarea
          className="m-input m-input--area"
          value={note}
          maxLength={NOTE_MAX_LEN}
          rows={3}
          placeholder="这一段时间做了什么"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
