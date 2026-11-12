/**
 * [应用趋势卡 · 今日分时] 把「今天每小时用了多久」这件事拆成**可验证的纯函数**。
 *
 * 为什么要拆出来：柱子高低错了没人看得出来（它只是"看起来矮一点"），
 * 而这条链上有四个易错点，每一个都是静默的：
 *   ① 时界必须落在**本地**整点。`toISOString()` 会按 UTC 切，东八区整档偏八小时。
 *   ② 后端 `validate_aggregate_boundaries` 要求边界**首 == startMs、末 == endMs**，
 *      差一毫秒整条 activity 读取就失败（前端只看到"没有数据"）。
 *   ③ 末窗口右端要裁到「此刻」：分母算上还没到的分钟，最后那根柱永远显矮。
 *   ④ 聚合命令返回的记录已被压成「起点 = 桶起点、长度 = 该桶时长」，
 *      位置信息丢了但**时长是对的**——趋势只要时长，正好合适；也因此绝不能拿它画时间轴。
 *
 * 旧版是「近 14 天每日」（`buildTrendQueryPlan`），主人要的口径是**只看今天**：
 * 一天之内看不出走势，"今天几点在干什么"才是有用的那句话。
 */
import { formatLocalDateKey, startOfLocalDay } from "../../../shared/lib/localDate.ts";

export interface TrendWindow {
  /** `YYYY-MM-DDTHH`：既是 React key 也是"这是哪个小时"的唯一标识 */
  key: string;
  startMs: number;
  endMs: number;
}

export interface TrendDay extends TrendWindow {
  durationMs: number;
}

export interface TrendQueryPlan {
  startMs: number;
  endMs: number;
  /** 逐时桶边界：`[startMs, h1.end, …, endMs]`，长度 = 窗口数 + 1 */
  boundaries: number[];
  windows: TrendWindow[];
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** 本地整点时间戳：**必须**由年月日时分构造，`+ 3600_000` 会在夏令时换轨那天漂一小时。 */
function localHourStart(dayStart: Date, hour: number): number {
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), hour).getTime();
}

/**
 * 「本地整点 → 时间戳」的签名。默认实现就是上面的 `localHourStart`，行为与从前逐字相同。
 *
 * 为什么要留这个口子：夏令时前跳日的重复边界只在**特定时区**出现，而 Node 会忽略
 * `TZ` 环境变量（实测），测试没法靠切时区复现。把这一层抽成参数之后，测试可以传入
 * 一个「02:00 被归一化成 03:00」的实现来复现同一个几何事实，而**生产语义一点没变**。
 */
export type LocalHourStamp = (dayStart: Date, hour: number) => number;

/**
 * 今日分时计划：从本地 00:00 起，每个整点一个窗口，到**当前这一小时**为止（含）。
 *
 * 三个边界口径，任何一个放松都会让卡片"看起来正常但没有数据"：
 *   · `startMs` 用 `startOfLocalDay`，不手写 `setHours(0,0,0,0)`，也绝不 `toISOString`；
 *   · 最后一个窗口的 `endMs` 裁到 `nowMs`（不是下一个整点）——与旧版「今天右端裁到此刻」
 *     同一条理由：没人想看一根被未来时间压扁的柱子；
 *   · 边界严格递增。两个来源会破坏它：夏令时**前跳**（02:00 不存在 → 02:00 与 03:00 落成
 *     同一个瞬间）与"恰好落在整点"的 `nowMs`（末窗口 start === end，长度 0）。两处用**同一条**
 *     判据收口：**算完 `endMs` 就在 push 之前判 `endMs <= hourStart` → 跳过这个 hour**。
 *     注意这条判据必须落在循环体里，不能堆在循环之后：循环后再扫只能从数组**末尾**弹，
 *     而前跳日那颗零长窗口在**中间**，弹不掉 —— 边界里就会留下两个相同的值。
 *     跳过之后下一个 hour 会顶上来补住被跳掉的那一格（前跳日照常产出 `[03:00, 04:00]`），
 *     所以 03:00–04:00 那一段时长不会"不属于任何窗口"地被静默丢掉。尾部 while 只作兜底。
 *     **不是理论问题**：`en-US` / `ru-RU` / `es` 这些夏季时区每年都会命中这条路。
 */
export function buildTodayHourPlan(nowMs: number, stampHour: LocalHourStamp = localHourStart): TrendQueryPlan {
  const now = new Date(nowMs);
  const dayStart = startOfLocalDay(now);
  const dayKey = formatLocalDateKey(dayStart);
  /* 极端保护：`nowMs` 恰是 00:00:00 时如果让 endMs === startMs，
     后端会因为空区间让整条读取失败、卡片变空。至少留 1ms。 */
  const cutoffMs = Math.max(nowMs, dayStart.getTime() + 1);

  const windows: TrendWindow[] = [];
  for (let hour = 0; hour <= now.getHours(); hour += 1) {
    const hourStart = stampHour(dayStart, hour);
    const previous = windows[windows.length - 1];
    /* 夏令时把某个整点抹掉时，两个 hour 会算出同一个起点：跳过，别造重复边界 */
    if (previous && hourStart <= previous.startMs) continue;
    if (hourStart >= cutoffMs) break;
    /* 右端**先算再判**：前跳日 `hour=2` 被归一化成 03:00，先 push 就会留下
       `[03:00, 03:00]`；而 `hour=3` 又从同一个瞬间起步。判在这里 → 零长的那个 hour 让位，
       `hour=3` 正常产出 `[03:00, 04:00]`。 */
    const endMs = Math.min(stampHour(dayStart, hour + 1), cutoffMs);
    if (endMs <= hourStart) continue;
    windows.push({ key: `${dayKey}T${pad2(hour)}`, startMs: hourStart, endMs });
  }
  /* 兜底：循环里的判据已经不会产出零长窗口，这里只为"一个窗口都没有"的极端情况留路
     （那时窗口数为 0、后面的 fallback 会接管）；留着是因为后端的判据是"边界非严格递增即拒"，
     它不该依赖上游某个前提没被改坏。 */
  while (windows.length > 0 && windows[windows.length - 1].endMs <= windows[windows.length - 1].startMs) {
    windows.pop();
  }
  if (windows.length === 0) {
    windows.push({
      key: `${dayKey}T${pad2(now.getHours())}`,
      startMs: dayStart.getTime(),
      endMs: cutoffMs,
    });
  }

  const startMs = windows[0].startMs;
  const endMs = windows[windows.length - 1].endMs;
  return {
    startMs,
    endMs,
    boundaries: [startMs, ...windows.map((window) => window.endMs)],
    windows,
  };
}

interface RangeRecord {
  startTime: number;
  endTime: number;
}

/**
 * 每条记录与**每个窗口**求交集再累加（窗口最多 24 个，不做区间树）。
 *
 * 为什么不是「按起点归桶」：跨整点的会话（09:50–10:20）按起点会整段算给 9 点，
 * 10 点凭空少 20 分钟。历史页的口径就是墙钟分摊（`MIN(end, 右) − MAX(start, 左)`），
 * 两处对不上时用户会发现"柱加起来 ≠ 历史页总数"。
 *
 * 边界外的残段（首尾跨出查询范围）靠同一个交集自然裁掉，不需要额外判断。
 */
export function accumulateTrendDays(windows: readonly TrendWindow[], records: readonly RangeRecord[]): TrendDay[] {
  const totals = windows.map((window) => ({ ...window, durationMs: 0 }));
  for (const record of records) {
    const start = Number(record.startTime);
    const end = Number(record.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    for (const lane of totals) {
      const overlap = Math.min(end, lane.endMs) - Math.max(start, lane.startMs);
      if (overlap > 0) lane.durationMs += overlap;
    }
  }
  return totals;
}
