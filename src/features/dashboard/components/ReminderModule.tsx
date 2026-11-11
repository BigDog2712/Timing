/**
 * 模块 · 提醒窗口（今天还有哪些提醒在等着响）。
 *
 * 数据是 `reminder_pending`（经 `platform/persistence/reminderReadRepository` 读取，
 * 不碰分析窗的 `api.ts` —— L9 双窗隔离）：**还没触发完**的提醒，不是历史。所以文案是"待提醒"，
 * 不能写成"今日提醒"—— 已经响过并处理掉的不在这个列表里，写成"今日"会让人以为漏了。
 *
 * 已过点（`remindAt <= now`）的排在最上面并加重语气：那些正是"该响还没处理"的。
 * 排序在 hook 里做（纯数据），这里只负责画。
 */
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { PendingRemindersState } from "../hooks/usePendingReminders.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { ReactNode } from "react";

interface Props {
  controls?: ReactNode;
  model: PendingRemindersState;
}

export default function ReminderModule({ controls, model }: Props) {
  const locale = useLocale();
  const copy = DASHBOARD_COPY[locale];
  const UI_TEXT = useLocaleText();
  const now = Date.now();
  const state = moduleState(model.status, false, model.reminders.length === 0);

  const timeLabel = (ms: number) => {
    try {
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
    } catch {
      return new Date(ms).toLocaleTimeString();
    }
  };

  return (
    <ModuleShell
      controls={controls}
      id="t-reminder"
      title={copy.reminderTitle}
      state={state}
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={model.retry}
      emptyText={copy.reminderEmpty}
      meta={model.reminders.length > 0 ? copy.reminderCount(model.reminders.length) : undefined}
    >
      <ul className="qp-reminder qp-scroll-region qp-scroll-region-stable">
        {model.reminders.map((reminder) => {
          const due = reminder.remindAt <= now;
          return (
            <li
              key={`${reminder.target}:${reminder.targetId}:${reminder.remindAt}`}
              className={due ? "qp-reminder__row is-due" : "qp-reminder__row"}
              data-reminder-target={reminder.target}
            >
              <time className="qp-reminder__time" dateTime={new Date(reminder.remindAt).toISOString()}>
                {timeLabel(reminder.remindAt)}
              </time>
              <span className="qp-reminder__title">{reminder.title}</span>
              <span className="qp-reminder__kind">{copy.reminderKinds[reminder.target]}</span>
              {due ? <span className="qp-reminder__due">{copy.reminderDue}</span> : null}
            </li>
          );
        })}
      </ul>
    </ModuleShell>
  );
}
