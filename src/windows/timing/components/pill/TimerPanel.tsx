/**
 * Timing — 计时小面板 TimerPanel（[B4] P2 §1.2 / PLAN A4 落实）
 * -----------------------------------------------------------------------------
 * 为什么要有这个面板：原先把「结束并保存」放在**本体层单击直达**上有两处——
 * 圆环右键、圆环上按 Enter。它是最不可逆的动作（`timer.stop` 在目录里标了
 * `irreversible: true`），却占了最高频、最容易误触的位置。A4 的处置是
 * **把不可逆动作降级为「面板内带确认的按钮」**，本体层只保留开始 / 暂停 / 读信息。
 *
 * 打开方式（两条，都进这一个面板）：
 *   · 点计时数字（运行 / 暂停态；空闲态点数字仍是正计时⇄倒计时切换，没有可结束的会话）；
 *   · 焦点在圆环上按 Enter。
 * 关闭：Esc / 关闭按钮 / 结束后自动收起；关闭时**焦点归还**给打开它的元素（P2 §4.2）。
 *
 * 确认语义：两步。第一次点变「确认结束并保存」，再点才真的结束（P1 的 ended 900ms 闪烁
 * 只是**结果反馈**，不能替代确认）。取消 / 关闭面板都会把确认步复位。
 *
 * 零字面量色值 / 零 px 字号：全部走主窗令牌。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { useTimerStore } from '../../stores/timerStore';
import { useItemStore, findItem } from '../../stores/itemStore';
import { useUiStore } from '../../stores/uiStore';
import { COUNTDOWN_WARN_SEC } from '../../lib/constants';
import { TimerDisplay } from './TimerDisplay';

export function TimerPanel() {
  const actions = useTimerActions();
  const seconds = useTimerTick();
  const session = useTimerStore((s) => s.state.session);
  const items = useItemStore((s) => s.items);
  const closePanel = useUiStore((s) => s.closePanel);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const stopBtnRef = useRef<HTMLButtonElement>(null);

  /* 打开前记下焦点，关闭时还回去（焦点不许丢到 body）；焦点开面板即落到第一个可操作项 */
  const restoreTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const active = document.activeElement;
    restoreTo.current = active instanceof HTMLElement ? active : null;
    stopBtnRef.current?.focus();
    return () => {
      const target = restoreTo.current;
      if (target && document.contains(target)) target.focus();
    };
  }, []);

  const name = findItem(items, session?.itemId ?? null)?.name ?? '未归类';
  const isCountdown = session?.mode === 'countdown' && session.targetSec != null;
  const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - seconds) : 0;
  const displaySec = isCountdown ? remaining : seconds;
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;

  const requestStop = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    /* `stop()` 按约定**从不 reject**（失败走全局 notice）；null = 被护栏挡下 / 没有会话 */
    void actions.stop().then(
      (result) => {
        setBusy(false);
        if (result) closePanel();
        else setConfirming(false);
      },
      () => {
        /* 兜底：真抛了也只退确认步，面板留着让人重试（错误已由 notice 呈现） */
        setBusy(false);
        setConfirming(false);
      },
    );
  }, [actions, confirming, closePanel]);

  return (
    <section
      className="panel timer-panel"
      role="dialog"
      aria-label="计时面板"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <header className="timer-panel__head">
        <span className="timer-panel__name" title={name}>
          {name}
        </span>
        <span className="timer-panel__meta">{isCountdown ? '倒计时' : '正计时'}</span>
      </header>

      <TimerDisplay
        seconds={displaySec}
        mode={isCountdown ? 'countdown' : 'countup'}
        size="lg"
        tone={nearEnd ? 'warn' : 'default'}
      />

      <footer className="timer-panel__foot">
        {confirming ? (
          <button type="button" className="btn btn--danger" disabled={busy} onClick={requestStop}>
            确认结束并保存？
          </button>
        ) : (
          /* 不可逆语义进可访问名（P2 §4.3）：读屏听到的是完整后果，不只是按钮名 */
          <button
            ref={stopBtnRef}
            type="button"
            className="btn btn--secondary"
            aria-label="结束并保存（不可撤销）"
            onClick={requestStop}
          >
            结束并保存
          </button>
        )}
        {confirming && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>
            取消
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={closePanel}>
          关闭
        </button>
      </footer>
    </section>
  );
}
