import { useLocale } from "../../../shared/i18n/index.ts";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { formatClock } from "../../../shared/lib/durationFormatting.ts";
import { formatDuration, formatTime } from "../services/historyFormatting.ts";
import { useHostTimerState } from "../../../app/hooks/useHostTimerState.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import { suggestItemName } from "../services/itemNameMatch.ts";

/**
 * 活动段 → 「在 Timing 计这件事」弹卡（P0-05）。
 *
 * ## 两条分支，一条铁律
 *
 *  · 宿主 **idle**：直接确认「在 Timing 计这件事」。
 *  · 宿主 **running / paused**：先问一句「正在计『写方案』12:31」+ [切换并开始] [取消]。
 *
 * 铁律：**「取消」零副作用**。取消分支只 `onClose()`，**不发任何 intent、不碰任何 store**——
 * 判据是 `get_timer_state` 前后逐字段相等（不切换、不结束、不计入切换）。所以这里连
 * 「顺手读一次状态」都不做多余动作：`useHostTimerState` 是只读订阅，不产生写入。
 *
 * ## 弹卡里不出现分析窗概念
 *
 * 只有「应用名 / 时段 / 时长 / 这件事叫什么」四件事（判据⑤）。分类、标签、泳道、热力图
 * 这些词一个都不出现——用户此刻的心智是「我刚才在干这件事，让我开始计它」。
 *
 * ## 事项名 = 应用名，同名复用、无则新建
 *
 * 匹配与新建都发生在**宿主**（`services/hostIntentBridge.ts`），本弹卡只负责把「叫什么」
 * 递过去，并把「会复用还是将新建」如实显示出来（`timer.items` 来自只读的 `list_items`）。
 * 这样即使两边列表短暂不一致，真正的判定仍只有一处。
 *
 * ## 文案
 *
 * 组件内 `COPY` + `useLocale()`，**不动 `src/shared/i18n/**`**（位置数组，增删即错位）。
 */
const COPY = {
  zh: {
    title: "这件事",
    range: "时段",
    duration: "时长",
    start: "在 Timing 计这件事",
    backfill: "补记为计时记录",
    switchAndStart: "切换并开始",
    cancel: "取消",
    close: "关闭",
    reuse: (name: string) => `将计入已有事项「${name}」`,
    suggest: (name: string) => `建议复用「${name}」（可改为新建）`,
    create: (name: string) => `将在 Timing 里新建事项「${name}」`,
    busyTitle: (name: string, clock: string) => `正在计「${name}」${clock}`,
    busyHint: "开始新计时会先把当前这段停下并保存。",
    pending: "已交给 Timing…",
    ariaLabel: "对这段活动在 Timing 计时",
  },
  en: {
    title: "This activity",
    range: "Period",
    duration: "Duration",
    start: "Track this in Timing",
    backfill: "Save as a record",
    switchAndStart: "Switch and start",
    cancel: "Cancel",
    close: "Close",
    reuse: (name: string) => `Will be tracked under the existing item "${name}"`,
    suggest: (name: string) => `Suggested: reuse "${name}" (or create a new one)`,
    create: (name: string) => `Will create a new Timing item "${name}"`,
    busyTitle: (name: string, clock: string) => `Currently tracking "${name}" ${clock}`,
    busyHint: "Starting a new timer will first stop and save the current one.",
    pending: "Handed to Timing…",
    ariaLabel: "Track this activity in Timing",
  },
} as const;

/** 一段活动要「计这件事」所需的全部信息（由 `HistoryHorizontalTimeline` 组装）。 */
export interface HistoryActivityActionTarget {
  /** 应用显示名 —— 同时就是要新建的事项名 */
  appName: string;
  /** 可执行名（`sessions.exe_name`），仅用于 `data-*` 与 `title` 排错 */
  exeName: string;
  startTimeMs: number;
  endTimeMs: number;
}

interface Props {
  target: HistoryActivityActionTarget;
  /** 关掉弹卡。「取消」分支也只调它——零副作用 */
  onClose: () => void;
}

export default function HistoryActivityActionDialog({ target, onClose }: Props) {
  const locale = useLocale();
  const copy = locale.startsWith("zh") ? COPY.zh : COPY.en;
  const timer = useHostTimerState();

  const appName = target.appName.trim();
  const busy = timer.ready && timer.status !== "idle";
  const runningName = timer.itemName ?? copy.title;
  /* P1-06：匹配交给纯函数（`services/itemNameMatch.ts`，§4.4 判据表）。
     三态必须**在文案与属性上都分得开**：`exact` 是结论，`contained` 只是建议——
     后者允许用户改主意，所以文案里要说「建议」。 */
  const suggestion = suggestItemName(appName, timer.items);
  const matchState = suggestion === null ? "create" : suggestion.kind === "exact" ? "reuse" : "suggest";
  /* intent 里递的是**解析后的事项名**（建议命中的那个），不是活动原名：
     递原名会让宿主按精确名找不到 → 新建一条 → 事项表里出现两个几乎同名的条目。 */
  const resolvedName = suggestion?.item.name ?? appName;
  const matchHint = suggestion === null
    ? copy.create(appName)
    : suggestion.kind === "exact" ? copy.reuse(suggestion.item.name) : copy.suggest(suggestion.item.name);
  const durationMs = Math.max(0, target.endTimeMs - target.startTimeMs);

  /* 唯一的写入点。两种情况都只发一条 intent —— 分析窗没有写命令，
     「切换」与「新建事项」全由宿主用自己的 IPC 做（`patina-host-bridge.toml` 的边界）。 */
  const start = () => {
    if (!appName) return;
    void emitHostIntent({ action: "start_timer_for_activity", itemName: resolvedName });
    onClose();
  };

  /* 补记（P1-01）：把**这一段**补成一条已完成的计时记录，语义与 `start` 正相反——
     那个是「从现在开始计」，这个「把刚才那一段记下来」，两者都不改计时状态机。
     右端 clamp 到当下：`endTimeMs` 对进行中的段是 `visibleEndMs`（不是活值），
     不 clamp 会在时钟回拨 / 秒级误差里命中宿主的 `INVALID_DURATION`（未来时间必拒）。 */
  const backfill = () => {
    if (!appName) return;
    void emitHostIntent({
      action: "backfill_record",
      itemName: resolvedName,
      startedAt: target.startTimeMs,
      endedAt: Math.min(target.endTimeMs, Date.now()),
    });
    onClose();
  };

  return (
    <QuietDialog
      open
      title={copy.title}
      onClose={onClose}
      surfaceClassName="history-activity-action-dialog-surface"
      actions={(
        <>
          <QuietButton tone="secondary" size="compact" onClick={onClose} data-history-activity-action="cancel">
            {busy ? copy.cancel : copy.close}
          </QuietButton>
          <QuietButton tone="secondary" size="compact" onClick={backfill} data-history-activity-action="backfill">
            {copy.backfill}
          </QuietButton>
          <QuietButton tone="primary" size="compact" onClick={start} data-history-activity-action="start">
            {busy ? copy.switchAndStart : copy.start}
          </QuietButton>
        </>
      )}
    >
      <div className="flex flex-col gap-2" aria-label={copy.ariaLabel}>
        <div
          className="flex items-baseline justify-between gap-3"
          data-history-activity-app={target.exeName}
        >
          <span className="qp-weight-emphasis text-[var(--qp-text-primary)]">{appName}</span>
          <span className="font-mono tabular-nums text-[var(--qp-text-secondary)]">
            {`${formatTime(target.startTimeMs, locale)} - ${formatTime(target.endTimeMs, locale)}`}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-[var(--qp-text-tertiary)]">
          <span>{copy.duration}</span>
          <span className="tabular-nums">{formatDuration(durationMs)}</span>
        </div>
        <p className="m-0 text-[var(--qp-text-secondary)]" data-history-activity-match={matchState}>
          {matchHint}
        </p>
        {busy && (
          <div
            className="mt-1 rounded-[var(--qp-radius-control)] border border-[var(--qp-border-subtle)] p-2"
            data-history-activity-busy="true"
          >
            <p className="m-0 qp-weight-emphasis text-[var(--qp-text-primary)]">
              {copy.busyTitle(runningName, formatClock(timer.liveSec))}
            </p>
            <p className="m-0 mt-1 text-[var(--qp-text-tertiary)]">{copy.busyHint}</p>
          </div>
        )}
      </div>
    </QuietDialog>
  );
}
