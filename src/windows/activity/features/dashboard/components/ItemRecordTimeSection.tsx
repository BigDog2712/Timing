/**
 * 「今日记录」区（原「改起止」弹层，[2026-11-20] 并入「编辑事项」）。
 *
 * ## 只改时刻，日期不在界面上
 *
 * 输入框是 `type="time"`（`HH:mm`），不再有 `datetime-local`。日锚点由**记录自己**
 * 带（`startOfLocalDay(segment.startedAt)`）—— 这一区只列今天的段，所以锚点就是今天，
 * 但取记录自己的日期比取"打开弹层那一刻"更抗跨零点。
 *
 * 两条输入锚在同一天，跨零点因此**表达不出来**：填 23:30–01:00 会走 B1
 * （`endBeforeStart`）。这比让用户选日期再被 B2 拦更直接，也不会生成一条
 * 把整天算给起始日的记录。
 *
 * ## 边界规则没变（B1–B6）
 *
 * 判定仍是 `validateRecordTime`（顺序即判据）：notSaved → endMissing → sameInstant
 * → endBeforeStart → crossDay。B3 的形态没变：进行中的段保存键 disabled，行上
 * **显示**说明。B4 的落点没变：payload 只有 `{recordId, startedAt, endedAt}`，
 * `accumulated_sec` 由 Rust 重算。
 *
 * ## 独立写路径（与保存键无关）
 *
 * 每段保存 = 恰一条 `update_record_time`，保存后只刷新本区、**不关弹层**：它和
 * 「名称 / 计时模式 / 标签」是两件事（同 `ItemAppBindingField`）。
 *
 * ## 拿不到记录 = 不画这一区
 *
 * 这一区是**附加信息**：读取失败或被 mock 挡掉时静默隐藏，不把「编辑事项」整张
 * 弹层打成错误态（用户来改名字时不该先看到一条红字）。
 */
import { useEffect, useMemo, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import { startOfLocalDay } from "../../../shared/lib/localDate.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import {
  parseClockOnDay,
  validateRecordTime,
  type RecordTimeIssue,
} from "../services/recordTimeEdit.ts";
import { useItemRecords, type ItemRecordSegment } from "../hooks/useItemRecords.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

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

interface Props {
  /** 当前选中的事项；`null` = 还没选事项（整区不渲染、也不拉数据） */
  itemId: number | null;
  /** 事项名（逐段「改起止」的 `aria-label`） */
  itemName: string;
}

export default function ItemRecordTimeSection({ itemId, itemName }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();

  /* 这一区只列今天的段；B2 的判域与 `useTodayItems` 同一个日区间 */
  const { dayStart, dayEnd } = useMemo(() => {
    const start = startOfLocalDay(new Date()).getTime();
    return { dayStart: start, dayEnd: start + DAY_MS };
  }, []);
  const { segments, status, reload } = useItemRecords(itemId, dayStart, dayEnd);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [startClock, setStartClock] = useState("");
  const [endClock, setEndClock] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditingId(null);
    setIssue(null);
    setSaved(false);
    setBusy(false);
  }, [itemId]);

  if (itemId === null || status !== "ready" || segments.length === 0) return null;

  const beginEdit = (segment: ItemRecordSegment) => {
    setEditingId(segment.id);
    setStartClock(clockOf(segment.startedAt));
    setEndClock(clockOf(segment.endedAt ?? Date.now()));
    setIssue(null);
    setSaved(false);
  };

  const canSave = (segment: ItemRecordSegment): boolean => {
    if (segment.endedAt === null) return false;
    return parseClockOnDay(startClock, dayStart) !== null
      && parseClockOnDay(endClock, dayStart) !== null;
  };

  const save = (segment: ItemRecordSegment) => {
    if (busy || editingId !== segment.id || !canSave(segment)) return;
    /* 日锚点取记录自己的本地日：两条输入都落在这一天，跨零点由 B1 拦住 */
    const anchor = startOfLocalDay(new Date(segment.startedAt)).getTime();
    const startedAt = parseClockOnDay(startClock, anchor);
    const endedAt = parseClockOnDay(endClock, anchor);
    if (startedAt === null || endedAt === null) return;
    const recordIssue = validateRecordTime(
      { startedAt, endedAt },
      { startedAt: segment.startedAt, endedAt: segment.endedAt, status: segment.status },
      anchor,
      anchor + DAY_MS,
    );
    if (recordIssue !== null) {
      setIssue(describeIssue(recordIssue, copy));
      return;
    }
    setBusy(true);
    /* 恰一条意图（B4：payload 没有时长字段，`accumulated_sec` 由 Rust 重算） */
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
    <section className="at-record-time" aria-label={copy.recordSectionTitle}>
      <h4 className="at-record-time-title">{copy.recordSectionTitle}</h4>
      <ul className="at-record-time-list">
        {segments.map((segment) => {
          const running = segment.endedAt === null;
          const editing = editingId === segment.id;
          return (
            <li key={segment.id} className="at-record-time-row" data-running={running || undefined}>
              {editing ? (
                <div className="at-record-time-editor">
                  <label className="at-record-time-field">
                    <span className="at-timeline-manage-label">{copy.recordStartLabel}</span>
                    <input
                      type="time"
                      className="at-input at-todo-time-input"
                      value={startClock}
                      aria-label={copy.recordStartLabel}
                      onChange={(event) => {
                        setStartClock(event.target.value);
                        setIssue(null);
                      }}
                    />
                  </label>
                  <label className="at-record-time-field">
                    <span className="at-timeline-manage-label">{copy.recordEndLabel}</span>
                    <input
                      type="time"
                      className="at-input at-todo-time-input"
                      value={endClock}
                      aria-label={copy.recordEndLabel}
                      onChange={(event) => {
                        setEndClock(event.target.value);
                        setIssue(null);
                      }}
                    />
                  </label>
                  <span className="at-timeline-item-editor-actions">
                    <button
                      type="button"
                      className="at-button at-button-compact at-button-primary"
                      disabled={busy || !canSave(segment)}
                      onClick={() => save(segment)}
                    >
                      {copy.timelineSaveAction}
                    </button>
                    <button
                      type="button"
                      className="at-button at-button-compact at-button-secondary"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                    >
                      {UI_TEXT.dialog.cancel}
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <span className="at-record-time-range">
                    {running
                      ? copy.timelineNoEnd(clockOf(segment.startedAt))
                      : copy.timelineRange(clockOf(segment.startedAt), clockOf(segment.endedAt as number))}
                  </span>
                  <span className="at-record-time-duration">
                    {formatDashboardDuration(running
                      ? segment.accumulatedSec * 1000 + Math.max(0, Date.now() - segment.startedAt)
                      : segment.accumulatedSec * 1000)}
                  </span>
                  <button
                    type="button"
                    className="at-link-btn at-timeline-item-action"
                    aria-label={`${copy.editRecordTime} ${itemName}`}
                    onClick={() => beginEdit(segment)}
                  >
                    {copy.editRecordTime}
                  </button>
                </>
              )}
              {running ? (
                <p className="at-record-time-note" role="note">{copy.onlySavedEditable}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {saved && !issue ? <p className="at-timeline-manage-issue" role="status">{copy.recordSaved}</p> : null}
      {issue ? <p className="at-timeline-manage-issue" role="alert">{issue}</p> : null}
    </section>
  );
}
