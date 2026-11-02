/**
 * TickBar — 待办提醒卡的正文（V0.3.12 / ADR-030）
 * -----------------------------------------------------------------------------
 * 两级提醒共用一个浮出卡（与 reminder-set / reminder-fired 同一张卡、同一套类名）：
 *   - `stage = 1` 轻提醒：正文「15 分钟后开始 / HH:MM · 要不要改时间？」+ 三个平移档；
 *   - `stage = 2` 自动开始：正文「HH:MM 开始 / 当前计时结束后自动开始？」，
 *     动作在卡片 footer（见 ReminderPopover）。
 * 只负责正文，动作按钮归调用方（footer 与键盘路径一起维护）。
 */
import { formatClockTime } from '../../lib/format';
import { NUDGE_SHIFTS, todoNudgeActions } from '../../services/todoNudgeActions';
import type { TodoNudge } from '../../types/domain';

export function NudgeBody({ nudge }: { nudge: TodoNudge }) {
  const light = nudge.stage === 1;
  return (
    <>
      <p className="reminder__line">{light ? '15 分钟后开始' : `${formatClockTime(nudge.remindAt)} 开始`}</p>
      <p className="reminder__sub">
        {light
          ? `${formatClockTime(nudge.remindAt)} · 要不要改时间？`
          : '当前计时结束后自动开始？'}
      </p>
      {light && (
        <div className="reminder__snooze" role="group" aria-label="改时间">
          {NUDGE_SHIFTS.map((shift) => (
            <button
              key={shift.label}
              type="button"
              className="reminder__snooze-btn"
              onClick={() => void todoNudgeActions.postpone(nudge, shift.ms)}
            >
              {shift.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
