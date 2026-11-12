import type { Locale } from "../../../shared/i18n/index.ts";
import { formatTime } from "../services/historyFormatting.ts";
import type {
  HistoryRangeNoteEntry,
  HistoryRangeTodoEntry,
} from "../services/historyRangeAggregate.ts";
import type { HistoryRangeCopy } from "../rangeCopy.ts";

/**
 * 区间里的两类**非时长**记录：便利贴（按创建时刻）与已完成待办（按完成时刻）。
 *
 * 两者都只显示"是什么 + 什么时候"，不提供编辑入口：
 * 这是历史页，写面一律回宿主自己（ADR-015 的只读边界）。
 * 便利贴正文只取首行并折断，因为一张便签可以很长，在复盘页里它不是主角。
 */
interface Props {
  copy: HistoryRangeCopy;
  locale: Locale;
  notes: HistoryRangeNoteEntry[];
  todos: HistoryRangeTodoEntry[];
}

function firstLine(content: string): string {
  const line = content.split(/\r?\n/u).find((candidate) => candidate.trim().length > 0);
  return (line ?? "").trim();
}

function stamp(timeMs: number, locale: Locale): string {
  const date = new Date(timeMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day} ${formatTime(timeMs, locale)}`;
}

export default function HistoryRangeRecords({ copy, locale, notes, todos }: Props) {
  return (
    <section className="qp-panel p-5 history-range-records" data-history-range-records>
      <div className="history-range-record-block" data-history-range-record-block="notes">
        <header className="history-range-card-head">
          <h3 className="history-range-card-title">{copy.notesTitle}</h3>
          <span className="history-range-card-meta">{notes.length}</span>
        </header>
        {notes.length === 0 ? (
          <p className="history-range-empty">{copy.notesEmpty}</p>
        ) : (
          <ul className="history-range-record-list qp-scroll-region">
            {notes.map((note) => (
              <li key={note.id} className="history-range-record-row" data-history-range-note>
                <span className="history-range-record-text" title={note.content}>
                  {firstLine(note.content) || "…"}
                </span>
                <span className="history-range-record-meta">
                  {note.itemName ? copy.noteOnItem(note.itemName) : null}
                  <span className="history-range-record-time">{stamp(note.createdAt, locale)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="history-range-record-block" data-history-range-record-block="todos">
        <header className="history-range-card-head">
          <h3 className="history-range-card-title">{copy.todosTitle}</h3>
          <span className="history-range-card-meta">{todos.length}</span>
        </header>
        {todos.length === 0 ? (
          <p className="history-range-empty">{copy.todosEmpty}</p>
        ) : (
          <ul className="history-range-record-list qp-scroll-region">
            {todos.map((todo) => (
              <li key={todo.id} className="history-range-record-row" data-history-range-todo>
                <span className="history-range-record-text" title={todo.title}>{todo.title}</span>
                <span className="history-range-record-meta">
                  {todo.plannedAt === null
                    ? null
                    : copy.todoPlanned(stamp(todo.plannedAt, locale))}
                  <span className="history-range-record-time">{stamp(todo.doneAt, locale)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
