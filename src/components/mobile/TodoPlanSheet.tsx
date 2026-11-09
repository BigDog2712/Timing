/**
 * Timing — 添加待办时排时间（V0.11.31）
 * -----------------------------------------------------------------------------
 * 主人原话：「添加待办支持输入预计时间，并有对应提醒功能，也可以不设置。
 * 支持设置几天后的待办事项。」
 *
 * 字段口径**照电脑版**（`TodosComposeCard` 的注释写死了这件事）：
 *   - 「什么时候做」→ `remind_at`（开启时间）。后端 `jobs::nudge` 以它为基准：
 *     开始前 15 分钟轻提醒、前 5 分钟问「要不要结束后自动开始」、到点若空闲直接开始；
 *   - 「也可以不设置」→ `remind_at = null`，待办立刻出现在今天的待办区，不提醒。
 *
 * 手机端**不暴露「截止时间」**（`planned_at`）：电脑版那张卡有开始 / 截止两个时间，
 * 手机上并排两个日期控件会让人分不清哪个是哪个，而且截止时间的唯一作用是逾期变红，
 * 这一版先不做——少一个能填错的框，比多一个功能更值。
 *
 * 时间输入用系统原生 `<input type="date"> / <input type="time">`：手机上它们直接调起
 * 系统滚轮，比自己画一套日历 + 小时分钟列表更准（也更省事），「几天后」用上面那排快捷键点。
 */
import { useState } from 'react';
import {
  dateInputValue,
  parseDateTimeInput,
  timeInputValue,
} from '../../lib/time';
import { ClockIcon, iconStroke } from '../../lib/icons';
import { ensureNotifyPermission } from '../../services/mobileNotify';
import { todosActions } from '../../services/todosActions';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useUiStore } from '../../stores/uiStore';
import { Sheet } from './Sheet';

/** 下一个整点（23 点时越到明天 00:00）：默认值给一个「明显在未来」的时刻 */
function nextHour(): number {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

/** N 天后的现在（保持用户选过的时刻不变，只把日期往后推） */
function daysLater(base: number, days: number): number {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

const QUICK = [
  { label: '今天', days: 0 },
  { label: '明天', days: 1 },
  { label: '3 天后', days: 3 },
  { label: '7 天后', days: 7 },
];

export function TodoPlanSheet({ title }: { title: string }) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const setNotice = useUiStore((s) => s.setNotice);
  const [at, setAt] = useState(nextHour);
  const [busy, setBusy] = useState(false);

  const dateValue = dateInputValue(at);
  const timeValue = timeInputValue(at);
  /* 过去的时间不给自己点：`remind_at` 落在过去时后端会走 `expire` 静默标成已处理，
     用户会看到「加了待办但到点什么都没发生」——那正是本仓最想避免的「点了没反应」。 */
  const past = at <= Date.now();

  const applyDate = (value: string) => {
    const next = parseDateTimeInput(value, timeValue);
    if (next != null) setAt(next);
  };
  const applyTime = (value: string) => {
    const next = parseDateTimeInput(dateValue, value);
    if (next != null) setAt(next);
  };

  const submit = async () => {
    if (busy || past || !title.trim()) return;
    setBusy(true);
    try {
      /* 请求通知权限必须在这次点击里（Android 13+ 要求系统弹窗绑用户手势），
         而且要在落库之前——被拒也要把待办加上，只是提醒降级为应用内提示。 */
      await ensureNotifyPermission();
      await todosActions.create(title.trim(), null, at);
      setNotice({ tone: 'info', text: '已排上，到点前 15 分钟会提醒你' });
      closeSheet('todoPlan');
    } catch (err) {
      setNotice({ tone: 'danger', text: `没能添加待办：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const onlyNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await todosActions.create(title.trim(), null, null);
      closeSheet('todoPlan');
    } catch (err) {
      setNotice({ tone: 'danger', text: `没能添加待办：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="排个时间"
      onClose={() => closeSheet('todoPlan')}
      footer={
        <div className="m-sheet__foot-row">
          <button type="button" className="m-btn m-field--grow" disabled={busy} onClick={() => void onlyNow()}>
            不排期
          </button>
          <button
            type="button"
            className="m-btn m-btn--primary"
            disabled={busy || past || !title.trim()}
            onClick={() => void submit()}
          >
            {busy ? '保存中…' : '就这个时间'}
          </button>
        </div>
      }
    >
      <p className="m-plan__title">{title.trim() || '（还没有内容）'}</p>

      <div className="m-plan__quick">
        {QUICK.map((q) => {
          const target = daysLater(nextHour(), q.days);
          const on = dateInputValue(target) === dateValue;
          return (
            <button
              key={q.label}
              type="button"
              className="m-btn m-btn--small m-plan__chip"
              data-on={on ? 'true' : 'false'}
              onClick={() => setAt(parseDateTimeInput(dateInputValue(target), timeValue) ?? at)}
            >
              {q.label}
            </button>
          );
        })}
      </div>

      <div className="m-plan__fields">
        <label className="m-field">
          <span className="m-field__label">哪天</span>
          <input type="date" className="m-input" value={dateValue} onChange={(e) => applyDate(e.target.value)} />
        </label>
        <label className="m-field">
          <span className="m-field__label">几点</span>
          <input type="time" className="m-input" value={timeValue} onChange={(e) => applyTime(e.target.value)} />
        </label>
      </div>

      {past ? (
        <p className="m-error" role="alert">
          这个时间已经过了，往后挑一点。
        </p>
      ) : (
        <p className="m-hint">
          <ClockIcon size={16} strokeWidth={iconStroke(16)} aria-hidden /> 到点前 15 分钟和 5
          分钟各提醒一次；到点没有在计时就自动开始。
        </p>
      )}
    </Sheet>
  );
}
