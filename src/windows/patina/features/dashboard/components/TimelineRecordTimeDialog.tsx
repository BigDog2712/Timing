/**
 * 「改起止」弹层（0.13 · T03b，设计 §3.8）：列出该事项**今天每一段**（起–止–总用时），
 * 逐段改起止时刻；保存发**一条** `update_record_time` 意图，由药丸的
 * `recordApi.update({id, patch:{startedAt, endedAt}})` 落库（命令面零改动）。
 *
 * ## 六条边界规则全部落在这里（判定顺序 = `validateRecordTime`，顺序即判据）
 *
 *   B1 严格小于 / B2 不跨零点 / B3 只改 saved / B4 前端**不许**算时长 /
 *   B5 逐段改不合并 / B6 跨零点给指引不生成。B4 的落地是：payload 只有
 *   `{recordId, startedAt, endedAt}` —— `RecordPatch` 根本没有时长字段，
 *   `accumulated_sec` 由 Rust 按新区间重算（ADR-030）。
 *
 * ## B3 的 UI 形态（V-1.6g）
 *
 * 进行中的段（`endedAt === null`）：保存键 `disabled` + 行上**显示**
 * `onlySavedEditable`（不是空白，也不是英文错误码）—— 宿主侧 `update` 对非 saved
 * 回的是误导性的 `ITEM_NOT_FOUND`，不能让用户走到那一步。
 *
 * ## 无回执的代价（与既有改名同型）
 *
 * 意图没有回执：发出即显示 `recordSaved`（"稍后刷新生效"），失败（`emit` 抛错）
 * 显示 `recordSaveFailed` 并保留弹层。区间整体替换、无待确认集（§3.8）。
 */
import { useEffect, useMemo, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import { startOfLocalDay } from "../../../shared/lib/localDate.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { DASHBOARD_COPY } from "../copy.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import {
  validateRecordTime,
  type RecordTimeIssue,
} from "../services/recordTimeEdit.ts";
import { formatDateTimeLocal, parseDateTimeLocal } from "../services/todoDraft.ts";
import { useItemRecords, type ItemRecordSegment } from "../hooks/useItemRecords.ts";

interface Props {
  /** `null` = 弹层关着（`useItemRecords` 不拉数据） */
  itemId: number | null;
  /** 弹层标题里的事项名（`itemId` 对应行上的名称） */
  itemName: string;
  onClose: () => void;
}

/** issue → 文案（`notSaved`/`endMissing` 共用 B3 的那句：都是"这条改不了"） */
function describeIssue(issue: RecordTimeIssue, copy: (typeof DASHBOARD_COPY)["zh-CN"]): string {
  if (issue === "notSaved" || issue === "endMissing") return copy.onlySavedEditable;
  if (issue === "sameInstant") return copy.recordZeroLength;
  if (issue === "endBeforeStart") return copy.endBeforeStart;
  return copy.crossDayHint;
}

function clockOf(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export default function TimelineRecordTimeDialog({ itemId, itemName, onClose }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();

  /* 本地日的 [0 点, 次日 0 点)：B2 的判域。挂载时算一次即可（弹层生命期不跨零点） */
  const { dayStart, dayEnd } = useMemo(() => {
    const start = startOfLocalDay(new Date()).getTime();
    return { dayStart: start, dayEnd: start + 24 * 60 * 60 * 1000 };
  }, []);
  const { segments, status, reload } = useItemRecords(itemId, dayStart, dayEnd);

  /* 正在编辑的段（一次只展开一段；B5：逐条改、不合并） */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (itemId === null) {
      setEditingId(null);
      setIssue(null);
      setSaved(false);
      setBusy(false);
    }
  }, [itemId]);

  const beginEdit = (segment: ItemRecordSegment) => {
    setEditingId(segment.id);
    setStartLocal(formatDateTimeLocal(segment.startedAt));
    setEndLocal(formatDateTimeLocal(segment.endedAt ?? Date.now()));
    setIssue(null);
    setSaved(false);
  };

  /* 两个输入都解析成功才允许保存（`datetime-local` 空值 = 没填完，按钮先 disabled） */
  const inputsReady = parseDateTimeLocal(startLocal) !== null && parseDateTimeLocal(endLocal) !== null;

  const save = () => {
    const segment = segments.find((entry) => entry.id === editingId);
    if (!segment || busy || !inputsReady) return;
    /* `parseDateTimeLocal` 对脏串回 null（弹层内不抛错）；到这里两个都是合法毫秒 */
    const startedAt = parseDateTimeLocal(startLocal) as number;
    const endedAt = parseDateTimeLocal(endLocal) as number;
    const recordIssue = validateRecordTime(
      { startedAt, endedAt },
      { startedAt: segment.startedAt, endedAt: segment.endedAt, status: segment.status },
      dayStart,
      dayEnd,
    );
    if (recordIssue !== null) {
      setIssue(describeIssue(recordIssue, copy));
      return;
    }
    setBusy(true);
    /* 恰一次意图（V-1.6e）：字段 camelCase，payload 里**没有**时长字段（B4）。
       emit 在非 Tauri 环境回 false —— 那是"没发出去"，不是"宿主拒了"。 */
    void emitHostIntent({ action: "update_record_time", recordId: segment.id, startedAt, endedAt })
      .then((sent) => {
        setBusy(false);
        if (!sent) {
          setIssue(copy.recordSaveFailed);
          return;
        }
        setIssue(null);
        setSaved(true);
        setEditingId(null);
        reload();
      });
  };

  return (
    <QuietDialog
      open={itemId !== null}
      title={`${copy.editRecordTime} · ${itemName}`}
      surfaceClassName="qp-timeline-manage-dialog"
      onClose={onClose}
      actions={(
        <button
          type="button"
          className="qp-button qp-button-compact qp-button-secondary"
          onClick={onClose}
        >
          {UI_TEXT.common.close}
        </button>
      )}
    >
      <div className="qp-record-time">
        {status === "loading" ? <p className="qp-empty">{UI_TEXT.common.loading}</p> : null}
        {status === "error" ? (
          <p className="qp-timeline-manage-issue" role="status">{UI_TEXT.common.readFailed}</p>
        ) : null}
        {status === "ready" ? (
          <ul className="qp-record-time-list">
            {segments.map((segment) => {
              const running = segment.endedAt === null;
              const editing = editingId === segment.id;
              return (
                <li
                  key={segment.id}
                  className="qp-record-time-row"
                  data-running={running || undefined}
                >
                  {editing ? (
                    <div className="qp-record-time-editor">
                      <label className="qp-record-time-field">
                        <span className="qp-timeline-manage-label">{copy.recordStartLabel}</span>
                        <input
                          type="datetime-local"
                          className="qp-input qp-todo-time-input"
                          value={startLocal}
                          aria-label={copy.recordStartLabel}
                          onChange={(event) => {
                            setStartLocal(event.target.value);
                            setIssue(null);
                          }}
                        />
                      </label>
                      <label className="qp-record-time-field">
                        <span className="qp-timeline-manage-label">{copy.recordEndLabel}</span>
                        <input
                          type="datetime-local"
                          className="qp-input qp-todo-time-input"
                          value={endLocal}
                          aria-label={copy.recordEndLabel}
                          onChange={(event) => {
                            setEndLocal(event.target.value);
                            setIssue(null);
                          }}
                        />
                      </label>
                      <span className="qp-timeline-item-editor-actions">
                        <button
                          type="button"
                          className="qp-button qp-button-compact qp-button-primary"
                          disabled={busy || running || !inputsReady}
                          onClick={save}
                        >
                          {copy.timelineSaveAction}
                        </button>
                        <button
                          type="button"
                          className="qp-button qp-button-compact qp-button-secondary"
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                        >
                          {UI_TEXT.dialog.cancel}
                        </button>
                      </span>
                    </div>
                  ) : (
                    <>
                      <span className="qp-record-time-range">
                        {running
                          ? copy.timelineNoEnd(clockOf(segment.startedAt))
                          : copy.timelineRange(clockOf(segment.startedAt), clockOf(segment.endedAt as number))}
                      </span>
                      <span className="qp-record-time-duration">
                        {formatDashboardDuration(running
                          ? segment.accumulatedSec * 1000 + Math.max(0, Date.now() - segment.startedAt)
                          : segment.accumulatedSec * 1000)}
                      </span>
                      <button
                        type="button"
                        className="qp-link-btn qp-timeline-item-action"
                        aria-label={`${copy.editRecordTime} ${itemName}`}
                        onClick={() => beginEdit(segment)}
                      >
                        {copy.editRecordTime}
                      </button>
                    </>
                  )}
                  {running ? (
                    <p className="qp-record-time-note" role="note">{copy.onlySavedEditable}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {saved && !issue ? <p className="qp-timeline-manage-issue" role="status">{copy.recordSaved}</p> : null}
        {issue ? <p className="qp-timeline-manage-issue" role="alert">{issue}</p> : null}
      </div>
    </QuietDialog>
  );
}
