import { ArrowUpRight } from "lucide-react";

import { useLocale } from "../../../shared/i18n/index.ts";
import { formatClock } from "../../../shared/lib/durationFormatting.ts";
import { useHostTimerState } from "../../../app/hooks/useHostTimerState.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";

/**
 * 工具页顶部的「Timing 计时中」状态行（P0-07）。
 *
 * ## 它解决的是「选错工具丢统计」
 *
 * 工具页里的番茄钟 / 自由专注是**专注会话**，不写 `time_records`、不进时间账；而在药丸上
 * 起的**计时**是进账的。用户在工具页里待着的时候，唯一能看见「原来现在有一条真正在进账的计时」
 * 的地方就是这一行 —— 没有它，用户会以为「这个应用现在什么都没在计时」。
 *
 * ## 读数一律复用 TB2-2 的通道，不另起一套
 *
 *  · 状态与秒数：`useHostTimerState`（宿主 `timer:state-changed` 广播 + 同一条 `computeHostLiveSec`
 *    公式）。**不新开 listen、不新开 IPC、不自己算秒** —— 一旦这里另算一套，就会出现
 *    「胶囊 12:31 / 状态行 12:29」这种同一数字两种写法。
 *  · 时长口径：`formatClock`（秒表 `12:31`），不是 `formatDuration`（概括 `2m`）。
 *  · 点击：`emitHostIntent({ action: 'show_pill' })` —— 分析窗没有写命令，回药丸只能表达意图。
 *
 * ## 三条边界
 *  ① `idle` 不渲染（也不渲染「未在计时」的空条，沿用全仓「不留空壳」口径）；
 *  ② `ready === false`（还没收到第一帧）同样不渲染，避免冷启动先闪一下再跳成计时中；
 *  ③ 文案走组件内 `COPY`，**不动 `src/shared/i18n/**`**（那四个 locale 是按索引对齐的位置数组）。
 */
const COPY = {
  zh: {
    label: "Timing 计时中",
    pausedLabel: "Timing 已暂停",
    ledger: "计时 · 计入时间账",
    open: "回到药丸",
  },
  en: {
    label: "Timing running",
    pausedLabel: "Timing paused",
    ledger: "Timer · counted in your time log",
    open: "Back to pill",
  },
} as const;

export default function HostTimingStatusRow() {
  const locale = useLocale();
  const copy = locale.startsWith("zh") ? COPY.zh : COPY.en;
  const timer = useHostTimerState();

  if (!timer.ready || timer.status === "idle") return null;

  const name = timer.itemName
    ?? (timer.session === null ? "" : `#${timer.session.itemId}`);
  /* 暂停不等于「计时中」：说成计时中会让用户以为时间还在涨。 */
  const label = timer.status === "paused" ? copy.pausedLabel : copy.label;

  /* aria-label 会把内部文字整体盖掉，所以「计入时间账」必须写进它，否则读屏用户听不到这句。 */
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-[var(--qp-radius-control)] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] px-3 py-1.5 text-left"
      aria-label={`${label}：${name} ${formatClock(timer.liveSec)} · ${copy.ledger} — ${copy.open}`}
      data-tools-host-timing-row={timer.status}
      data-tools-host-timing-item={name}
      data-tools-host-timing-live-sec={timer.liveSec}
      onClick={() => { void emitHostIntent({ action: "show_pill" }); }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: "var(--qp-accent-default)" }}
        aria-hidden="true"
      />
      <span className="shrink-0 text-[var(--qp-text-tertiary)]">{`${label}：`}</span>
      <span className="min-w-0 truncate qp-weight-emphasis text-[var(--qp-text-primary)]" title={name}>
        {name}
      </span>
      <span className="shrink-0 font-mono tabular-nums text-[var(--qp-text-primary)]">
        {formatClock(timer.liveSec)}
      </span>
      <span className="ml-1 shrink-0 text-[var(--qp-text-tertiary)]">{`· ${copy.ledger}`}</span>
      <ArrowUpRight size={12} strokeWidth={2} className="ml-auto shrink-0 text-[var(--qp-text-tertiary)]" aria-hidden="true" />
    </button>
  );
}
