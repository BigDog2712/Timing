import { useEffect, useState } from "react";
import { ArrowUpRight, Pause, Play } from "lucide-react";

import { useLocale } from "../../shared/i18n/index.ts";
import { formatClock } from "../../shared/lib/durationFormatting.ts";
import { useHostTimerState, type HostTimerView } from "../hooks/useHostTimerState.ts";
import { emitHostIntent } from "../../platform/runtime/hostIntentGateway.ts";

/**
 * 分析窗标题栏的「Timing 计时胶囊」（P0-04）。
 *
 * ## 只读 + 只表达意图
 *
 * 分析窗**没有**任何写命令（`patina-host-bridge.toml` 的边界）。暂停/继续与「回药丸」
 * 都只发一条 `patina:host-intent`（`hostIntentGateway.ts`），由药丸用它自己的 IPC 执行。
 * 本组件不直接碰传输层：只经 `useHostTimerState` 与 `emitHostIntent` 两个门面（L1）。
 *
 * ## 为什么不渲染「未知」态
 *
 * `status === 'idle'` 时整条胶囊消失（ARCH P0-04 判据⑤：不留空壳）。`ready === false`
 * （还没收到第一帧）时**同样**不渲染 —— 否则冷启动会先闪一下「没有计时」，再跳成正在跑。
 *
 * ## 文案
 *
 * 走组件内 `COPY`（`useLocale()`），**不动 `src/shared/i18n/**`**：那四个 locale 是按索引
 * 对齐的位置数组，增删一行会让其后全部文案错位（`HistoryTimingLane.tsx:21-23` 同口径）。
 */
const COPY = {
  zh: {
    live: "已计时",
    today: "今日",
    pause: "暂停计时",
    resume: "继续计时",
    openPill: "回到药丸",
    busy: "正在处理",
  },
  en: {
    live: "Elapsed",
    today: "Today",
    pause: "Pause timer",
    resume: "Resume timer",
    openPill: "Back to pill",
    busy: "Working",
  },
} as const;

export default function TimingCapsule() {
  const locale = useLocale();
  const copy = locale.startsWith("zh") ? COPY.zh : COPY.en;
  const timer: HostTimerView = useHostTimerState();
  /** 在途意图的锁：连点两次「暂停」会发出两条 toggle，方向就被来回切掉了 */
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!busy) return undefined;
    /* 兜底解锁：意图没有回执，正常情况靠下面的 `status` 变化解锁；
       若宿主没执行（窗没就绪 / 被拒），1.2s 后必须解锁，否则按钮永久置灰。 */
    const id = window.setTimeout(() => setBusy(false), 1200);
    return () => window.clearTimeout(id);
  }, [busy]);

  /* 状态真的变了 = 意图已生效，立刻解锁（不必等兜底超时） */
  useEffect(() => {
    setBusy(false);
  }, [timer.status]);

  if (!timer.ready || timer.status === "idle") return null;

  const running = timer.status === "running";
  const name = timer.itemName ?? (timer.session === null ? "" : `#${timer.session.itemId}`);

  const send = (intent: { action: "toggle_timer" } | { action: "show_pill" }) => {
    if (busy) return;
    setBusy(true);
    void emitHostIntent(intent);
  };

  return (
    <section
      className="app-titlebar-timing flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] py-0.5 pl-2 pr-1"
      aria-label={copy.live}
      data-titlebar-timing-capsule={timer.status}
      data-titlebar-timing-item={name}
      data-titlebar-timing-live-sec={timer.liveSec}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: "var(--qp-accent-default)", opacity: running ? 1 : 0.45 }}
        aria-hidden="true"
      />
      <span className="max-w-[9rem] truncate text-[var(--qp-text-primary)]" title={name}>
        {name}
      </span>
      <span
        className="shrink-0 font-mono tabular-nums text-[var(--qp-text-primary)]"
        aria-label={`${copy.live} ${formatClock(timer.liveSec)}`}
      >
        {formatClock(timer.liveSec)}
      </span>
      {timer.todaySec !== null && (
        /* `data-titlebar-capsule-today` 是窄宽档隐藏今日列的**稳定钩子**：
           窄宽档靠它省 75.3px 给名字列（topbar.css 的 max-width: 999.98px 块）。
           不要换成 :nth-child / :last-of-type —— 胶囊内部结构一改就静默失效且不会红。 */
        <span
          className="shrink-0 font-mono tabular-nums text-[var(--qp-text-tertiary)]"
          data-titlebar-capsule-today=""
          aria-label={`${copy.today} ${formatClock(timer.todaySec)}`}
          title={`${copy.today} ${formatClock(timer.todaySec)}`}
        >
          {`· ${formatClock(timer.todaySec)}`}
        </span>
      )}
      <button
        type="button"
        className="qp-cap-action"
        aria-label={running ? copy.pause : copy.resume}
        aria-busy={busy}
        data-titlebar-timing-action="toggle"
        onClick={() => send({ action: "toggle_timer" })}
      >
        {running
          ? <Pause size={12} strokeWidth={2} aria-hidden="true" />
          : <Play size={12} strokeWidth={2} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="qp-cap-action"
        aria-label={copy.openPill}
        data-titlebar-timing-action="show-pill"
        onClick={() => send({ action: "show_pill" })}
      >
        <ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </section>
  );
}
