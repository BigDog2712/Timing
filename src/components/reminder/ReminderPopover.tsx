/**
 * TickBar — 提醒浮出卡 ReminderPopover（reminder-popover.md · V0.2.0 新增 N-5）
 * -----------------------------------------------------------------------------
 * 贴近小条浮出的非模态玻璃卡（层 --z-dialog 70，宽 280）。两种态：
 *   - `set`  ：右键「提醒…」→ 选时间（+5/15/60 分 / 明天此时）→ reminder_set；展示既有 pending 可清除。
 *   - `fired`：后台 reminder-fired → ±60s 聚合单卡（AC-61）：主文「已经到时了」+ 动作
 *              [稍后提醒] [开始新计时] [关闭]；多条 → 「N 条事项到点」。
 * 边界（§3.1）：**提醒 ≠ 结束计时**——「开始新计时」是显式动作，「到点自动结束」归倒计时。
 * 不自动消失（提醒须被看到）；Esc 关闭；Enter 触发主动作；S 展开「稍后」。
 */
import { useEffect, useMemo, useState } from 'react';
import { useReminderKeys } from './useReminderKeys';
import { NudgeBody } from './NudgeBody';
import { formatClockTime } from '../../lib/format';
import { BellIcon, BellRingIcon, PlayIcon, XIcon } from '../../lib/icons';
import { ipc } from '../../services/ipc';
import { reminderActions, clearFiredItem, clearAllFired } from '../../services/reminderActions';
import { todoNudgeActions } from '../../services/todoNudgeActions';
import type { ReminderPopoverState } from '../../stores/uiStore';
import type { Reminder } from '../../types/domain';
import { useHoverClose } from '../../hooks/useHoverClose';
import { fitBounds } from '../../lib/fitBounds';

const W = 280;
const H = 178;
const EDGE = 4;

/** 稍后 / 快捷时间档（毫秒） */
const OFFSETS: { label: string; ms: number }[] = [
  { label: '5 分钟', ms: 5 * 60_000 },
  { label: '15 分钟', ms: 15 * 60_000 },
  { label: '1 小时', ms: 60 * 60_000 },
  { label: '明天此时', ms: 24 * 60 * 60_000 },
];

interface ReminderPopoverProps {
  state: ReminderPopoverState;
}

export function ReminderPopover({ state }: ReminderPopoverProps) {
  /* [V0.2.7] 指针离开提醒卡即自动收起 */
  useHoverClose(reminderActions.close);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [pending, setPending] = useState<Reminder[]>([]);
  const { mode, target, targetId, title } = state;

  /* 设置态：拉该目标的既有提醒（可逐条清除） */
  useEffect(() => {
    if (mode !== 'set') return;
    let cancelled = false;
    void ipc
      .reminderPending()
      .then((list) => {
        if (!cancelled) setPending(list.filter((r) => r.target === target && r.targetId === targetId));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode, target, targetId]);

  const fired = state.fired ?? [];
  const merged = fired.length > 1;
  const firstFired = fired[0];
  /* [V0.3.12] 待办两级提醒：与到点卡同一张卡，靠 stage 区分正文与动作（ADR-030） */
  const nudge = state.nudge;
  const isNudge = mode === 'nudge' && nudge != null;
  const lightNudge = isNudge && nudge.stage === 1;

  const heading = useMemo(() => {
    if (isNudge) return lightNudge ? `轻提醒 · ${title}` : `即将开始 · ${title}`;
    if (mode === 'set') return `提醒 · ${title}`;
    return merged ? `${fired.length} 条事项到点` : `提醒 · ${title}`;
  }, [isNudge, lightNudge, mode, title, merged, fired.length]);

  useReminderKeys({
    onEscape: () => reminderActions.close(),
    onEnter: () => {
      if (isNudge) {
        if (lightNudge) todoNudgeActions.close();
        else void todoNudgeActions.startNow(nudge);
        return;
      }
      if (mode === 'fired') void reminderActions.startNewTimer(state);
      else void reminderActions.setRemindAt(target, targetId, Date.now() + OFFSETS[0].ms);
    },
    onSnooze: () => setSnoozeOpen((v) => !v),
  });

  /* [ADR-020] 贴边钳制按「显示器工作区」算：主窗没有画布了，读 window.innerWidth
     会把浮层硬挤到胶囊上。fitBounds() 非主窗自动回落真实视口；主窗返回层坐标
     （x/y 为负），右/下边界写成 x + w、y + h。 */
  const viewport = fitBounds();
  /* 轻提醒多一行平移档，卡片更高：夹取时按实际高度算，别让卡片被裁在屏幕外 */
  const cardH = lightNudge ? H + 40 : H;
  const left = Math.min(Math.max(state.pos.x, EDGE), Math.max(EDGE, viewport.x + viewport.w - W - EDGE));
  const top = Math.min(Math.max(state.pos.y, EDGE), Math.max(EDGE, viewport.y + viewport.h - cardH - EDGE));

  return (
    <>
      <div className="menu-scrim" onMouseDown={() => reminderActions.close()} aria-hidden />
      <div className="reminder" style={{ left: `${left}px`, top: `${top}px` }} role="dialog" aria-label={heading}>
        <header className="reminder__head">
          <span className="reminder__bell" aria-hidden>
            {mode === 'fired' ? (
              <BellRingIcon size={20} strokeWidth={2} />
            ) : (
              <BellIcon size={20} strokeWidth={2} />
            )}
          </span>
          <h2 className="reminder__title">{heading}</h2>
        </header>

        <div className="reminder__body">
          {isNudge ? (
            <NudgeBody nudge={nudge} />
          ) : mode === 'fired' ? (
            merged ? (
              <ul className="reminder__pending">
                {fired.map((f, i) => (
                  <li key={`${f.target}-${f.targetId}`} className="reminder__pending-row">
                    <span className="reminder__pending-time">{formatClockTime(f.remindAt)}</span>
                    <span className="reminder__fired-title" title={f.title}>
                      {f.title}
                    </span>
                    <button type="button" className="reminder__clear" onClick={() => clearFiredItem(i)}>
                      清除
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="reminder__line">已经到时了</p>
                <p className="reminder__sub">
                  {formatClockTime(state.remindAt ?? firstFired?.remindAt ?? null)} 到点
                </p>
              </>
            )
          ) : (
            <>
              <p className="reminder__line">设置提醒时间</p>
              {pending.length > 0 && (
                <ul className="reminder__pending">
                  {pending.map((r) => (
                    <li key={`${r.target}-${r.targetId}`} className="reminder__pending-row">
                      <span className="reminder__pending-time">{formatClockTime(r.remindAt)}</span>
                      <button
                        type="button"
                        className="reminder__clear"
                        onClick={() => {
                          void reminderActions.clear(r.target, r.targetId);
                          setPending((list) => list.filter((x) => !(x.target === r.target && x.targetId === r.targetId)));
                        }}
                      >
                        清除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {!isNudge && snoozeOpen && (
          <div className="reminder__snooze" role="group" aria-label="稍后提醒">
            {OFFSETS.map((o) => (
              <button
                key={o.label}
                type="button"
                className="reminder__snooze-btn"
                onClick={() => void reminderActions.setRemindAt(target, targetId, Date.now() + o.ms)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        <footer className="reminder__actions">
          {isNudge ? (
            lightNudge ? (
              <button type="button" className="btn btn--primary reminder__btn" onClick={() => todoNudgeActions.close()}>
                不用改
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn--ghost reminder__btn"
                  onClick={() => void todoNudgeActions.autoStart(nudge)}
                >
                  结束后自动开始
                </button>
                <button
                  type="button"
                  className="btn btn--primary reminder__btn"
                  onClick={() => void todoNudgeActions.startNow(nudge)}
                >
                  <PlayIcon size={16} strokeWidth={2.5} aria-hidden />
                  现在就开始
                </button>
              </>
            )
          ) : (
            <>
              <button type="button" className="btn btn--ghost reminder__btn" onClick={() => setSnoozeOpen((v) => !v)}>
                稍后提醒
              </button>
              {mode === 'fired' ? (
                <button
                  type="button"
                  className="btn btn--primary reminder__btn"
                  onClick={() => void reminderActions.startNewTimer(state)}
                >
                  <PlayIcon size={16} strokeWidth={2.5} aria-hidden />
                  开始新计时
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary reminder__btn"
                  onClick={() => void reminderActions.setRemindAt(target, targetId, Date.now() + OFFSETS[1].ms)}
                >
                  15 分钟后
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="reminder__close"
            aria-label="关闭"
            title="关闭"
            onClick={() => (isNudge ? todoNudgeActions.close() : reminderActions.close())}
          >
            <XIcon size={16} strokeWidth={2.5} aria-hidden />
          </button>
        </footer>

        {mode === 'fired' && merged && (
          <button type="button" className="reminder__clear-all" onClick={() => clearAllFired()}>
            全部清除
          </button>
        )}
      </div>
    </>
  );
}
