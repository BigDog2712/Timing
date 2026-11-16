/**
 * [0.12.5] 使用时段的算术与文案（纯函数，不认识 React）。
 *
 * 用户要的不是「一共 40 分钟」，而是「9:00-9:30、10:00-10:10」—— 一天里断成三次和
 * 连着四十分钟在时长上一模一样，只有时段能分清。这一份负责把后端给的段整理成
 * 能直接渲染的样子，单独拎出来是因为它**会静默算错**：不排序就画出交错的段、
 * 不合并就会把重叠的时间算两遍、跨午夜的段会被显示成「23:50-00:10」。
 *
 * 后端 `services::usage::merge_spans` 已经合并过一次。这里**再做一次**不是重复劳动：
 * 浏览器 mock、旧版回值、以及「两天窗口边界处同一条段被写进相邻两天」都会绕过那个保证，
 * 而重复合并是幂等的。
 *
 * 两端都必须容忍 **≤ 1 分钟** 的空隙（0.12.8，用户原话「不足一分钟的计时应忽略
 * 或自动合并」）：按 Activity 配出的段之间有几十毫秒到几十秒的空隙，不并的话
 * 一次连续使用被切成一串「09:01-09:02」。只桥 ≤ 1 分钟 —— 更长的空隙意味着
 * 用户真的离开了，把那段并进使用时长才是编造没发生过的事实。
 */
import type { UsageSpan } from '../../types/domain/usage';
import { clockText, formatSpanCN } from './usageFormat';

/**
 * 排序 + 合并重叠、相接、以及空隙 ≤ 1 分钟的段，丢掉空段。
 *
 * - 相接（`next.from === last.to`）也合并：中间没有别的应用或息屏，本来就是一整段。
 * - ≤ `MERGE_GAP_MS` 的空隙并入两端（同应用换 Activity、回桌面秒回的碎段由此消失）。
 * - 重叠取并集，**不是相加**：`09:00-09:30` 与 `09:10-09:40` 是 `09:00-09:40`。
 * - `to <= from` 的段丢掉 —— 显示成「09:00-09:00」既是噪声也会让「时长之和」对不上。
 *
 * 判据在 `usageSpans.test.ts`：乱序、重叠、包含、真断开、窄空隙、空段、空输入。
 */
export function mergeSpans(spans: readonly UsageSpan[]): UsageSpan[] {
  const MERGE_GAP_MS = 60_000;
  const valid = spans
    .filter((span) => Number.isFinite(span.from) && Number.isFinite(span.to) && span.to > span.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const out: UsageSpan[] = [];
  for (const span of valid) {
    const last = out[out.length - 1];
    if (last != null && span.from <= last.to + MERGE_GAP_MS) {
      if (span.to > last.to) last.to = span.to;
      continue;
    }
    out.push({ from: span.from, to: span.to });
  }
  return out;
}

/** 从一行取时段（**唯一**入口）：没有这个键就是空数组，不返回 `undefined` 让调用方再判。 */
export function spansOf(row: { spans?: UsageSpan[] }): UsageSpan[] {
  return mergeSpans(row.spans ?? []);
}

/**
 * 列表里至少要多长才值得占一行 —— **1 分钟**。
 *
 * 为什么要卡这道线（0.12.8 用户反馈的原话是「多段不到一分钟计时」）：解锁后从桌面点开
 * 微信，中间那 2 秒的桌面、看一眼通知就退出的 8 秒，都是**真数据但没信息量**；
 * 一天能有上百条，列表一屏全是「09:01 - 09:01」。而用户要看的是「9:00-9:30、10:00-10:10」。
 *
 * 为什么不在采集层就丢掉：丢了之后「合计 5 小时、时段只有 40 分钟」就无法解释了。
 * 数据全留（`app_usage_span` 里也全留），只在**展示**这一层决定列不列。
 */
export const MIN_VISIBLE_SPAN_MS = 60_000;

/** 一段的净长度（毫秒）。不做 `Math.max(1s, …)` 的兜底 —— 用时长的口径判断不能造假。 */
export function spanRawMillis(span: UsageSpan): number {
  return span.to - span.from;
}

/** 值得列出来的段：先合并，再滤掉不足 1 分钟的。 */
export function visibleSpans(spans: readonly UsageSpan[]): UsageSpan[] {
  return mergeSpans(spans).filter((span) => spanRawMillis(span) >= MIN_VISIBLE_SPAN_MS);
}

/** 被滤掉的短段条数（「另有 N 次不到 1 分钟」）。 */
export function shortSpans(spans: readonly UsageSpan[]): UsageSpan[] {
  return mergeSpans(spans).filter((span) => spanRawMillis(span) < MIN_VISIBLE_SPAN_MS);
}

/** 一段的时长（毫秒），至少 1 秒 —— 段的边界可能只差几百毫秒，但「0 秒」不是人话。 */
export function spanMillis(span: UsageSpan): number {
  return Math.max(1000, span.to - span.from);
}

/** 「09:00 - 09:30」。用 `clockText`（本机时区），不用 `toISOString`（那是 UTC，会早 8 小时）。 */
export function spanClockText(span: UsageSpan): string {
  return `${clockText(span.from)} - ${clockText(span.to)}`;
}

/** 「30 分钟」：句子里的长度，与洞察句同一口径（`formatSpanCN`）。 */
export function spanLengthCN(span: UsageSpan): string {
  return formatSpanCN(Math.round(spanMillis(span) / 1000));
}

/** 「3 段」。0 段是合法的（老日期系统已回收明细），回「0 段」而不是空白。 */
export function spanCountText(count: number): string {
  return `${Math.max(0, Math.trunc(count))} 段`;
}

/**
 * 一天里的「空档」：相邻两段之间的间隔，按从大到小。
 *
 * 用来回答「中间隔了多久」—— 时段列表本身只显示用的时候，用户会自己算，
 * 算不准。间隔小于 `minGapMs` 的不算（切屏瞬间的半分钟不是「空档」）。
 */
export function spanGaps(spans: readonly UsageSpan[], minGapMs = 5 * 60 * 1000): number[] {
  const merged = mergeSpans(spans);
  const gaps: number[] = [];
  for (let i = 1; i < merged.length; i += 1) {
    const gap = merged[i].from - merged[i - 1].to;
    if (gap >= minGapMs) gaps.push(gap);
  }
  return gaps.sort((a, b) => b - a);
}
