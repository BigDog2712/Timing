/**
 * 「新建待办」的**多日期 × 多时刻**表单控件（0.13 · 1.7）—— [本轮] 从 `TodoComposeDialog`
 * 拆出来（那张弹层还要装名称与提醒勾选，塞一起必破 300 行棘轮）。
 *
 * ## 为什么是"chip 列表"而不是两个多选框
 *
 * `type="date"` / `type="time"` 的原生控件都只能选**一个**值；多选靠"选一个 → 加进列表 →
 * 可移除"的 chip 流。已选项去重（同一日期/时刻加两遍只留一个）由这里负责，
 * 笛卡尔展开与校验在 `services/todoBatch.expandTodoBatch`（纯函数，弹层不写口径）。
 *
 * ## 时刻的排序契约
 *
 * 展示顺序 = 添加顺序？不 —— 同一天的 09:00 和 21:00 谁先谁后用户不关心，
 * 但 `expandTodoBatch` 会去重并按**输入顺序**展开。这里保持输入顺序原样上交
 * （不做排序：21:00 的提醒优先级与 09:00 无关，排序纯属装饰）。
 */
import { useState } from "react";

import { useLocale } from "../../../shared/i18n/index.ts";
import { describeBatchDate } from "../services/todoBatch.ts";
import { DASHBOARD_COPY } from "../copy.ts";

interface Props {
  /** 已选日期（`YYYY-MM-DD` 原样值） */
  dates: readonly string[];
  /** 已选时刻（`HH:mm` 原样值） */
  times: readonly string[];
  onDatesChange: (dates: readonly string[]) => void;
  onTimesChange: (times: readonly string[]) => void;
}

export default function TodoBatchFields({ dates, times, onDatesChange, onTimesChange }: Props) {
  const locale = useLocale();
  const copy = DASHBOARD_COPY[locale];
  const [dateDraft, setDateDraft] = useState("");
  const [timeDraft, setTimeDraft] = useState("");

  const addDate = () => {
    const value = dateDraft.trim();
    if (value === "" || dates.includes(value)) return;
    onDatesChange([...dates, value]);
    setDateDraft("");
  };

  const addTime = () => {
    const value = timeDraft.trim();
    if (value === "" || times.includes(value)) return;
    onTimesChange([...times, value]);
    setTimeDraft("");
  };

  const removeDate = (value: string) => onDatesChange(dates.filter((entry) => entry !== value));
  const removeTime = (value: string) => onTimesChange(times.filter((entry) => entry !== value));

  return (
    <div className="qp-todo-batch">
      <div className="qp-todo-field">
        <span className="qp-todo-field-label" id="qp-todo-batch-dates">{copy.todoBatchDates}</span>
        <div className="qp-todo-batch-picker" role="group" aria-labelledby="qp-todo-batch-dates">
          <input
            type="date"
            className="qp-input qp-todo-time-input"
            value={dateDraft}
            aria-label={copy.todoBatchDates}
            onChange={(event) => setDateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDate();
              }
            }}
          />
          <button
            type="button"
            className="qp-button qp-button-compact qp-button-secondary"
            disabled={dateDraft.trim() === ""}
            aria-label={copy.todoBatchAddTime}
            onClick={addDate}
          >
            {copy.todoBatchAddTime}
          </button>
        </div>
        {dates.length > 0 ? (
          <ul className="qp-todo-batch-chips">
            {dates.map((value) => (
              <li key={value} className="qp-todo-batch-chip">
                <span>{describeBatchDate(value, locale)}</span>
                <button
                  type="button"
                  className="qp-todo-batch-chip-remove"
                  aria-label={copy.todoBatchRemove(describeBatchDate(value, locale))}
                  onClick={() => removeDate(value)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="qp-todo-field">
        <span className="qp-todo-field-label" id="qp-todo-batch-times">{copy.todoBatchTimes}</span>
        <div className="qp-todo-batch-picker" role="group" aria-labelledby="qp-todo-batch-times">
          <input
            type="time"
            className="qp-input qp-todo-time-input"
            value={timeDraft}
            aria-label={copy.todoBatchTimes}
            onChange={(event) => setTimeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTime();
              }
            }}
          />
          <button
            type="button"
            className="qp-button qp-button-compact qp-button-secondary"
            disabled={timeDraft.trim() === ""}
            aria-label={copy.todoBatchAddTime}
            onClick={addTime}
          >
            {copy.todoBatchAddTime}
          </button>
        </div>
        {times.length > 0 ? (
          <ul className="qp-todo-batch-chips">
            {times.map((value) => (
              <li key={value} className="qp-todo-batch-chip">
                <span>{value}</span>
                <button
                  type="button"
                  className="qp-todo-batch-chip-remove"
                  aria-label={copy.todoBatchRemove(value)}
                  onClick={() => removeTime(value)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
