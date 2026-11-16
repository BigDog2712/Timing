/**
 * [0.12.8] 「用它的时段」—— 9:00-9:30、10:00-10:10 那个列表。
 *
 * 为什么单独立一个组件：详情页已经有趋势柱、三个读数格和一句提示，再塞一段带序号的
 * 列表就顶到 300 行上限（`check:size`）；而这块在单日视图里也用得上（下一步）。
 *
 * 三条口径：
 * - **段是先合并再渲染的**（`mergeSpans`）：后端读过一次，但旧回值与 mock 不保证，
 *   重复合并是幂等的；不合并的表现是两条时间交错的读数，加起来比合计还长。
 * - **不足 1 分钟的段不列**（`MIN_VISIBLE_SPAN_MS`）：解锁瞬间的 2 秒桌面、看一眼通知
 *   就退出的 8 秒都是真数据但没信息量，一天上百条，列表就成了「全是 09:01-09:01」。
 *   它们不丢掉，只折成一句「另有 N 次」—— 数据在库里，用户想看的是「分几次用的」。
 * - **空态必须说清是哪一种空**：老日期系统已回收明细（我们只有合计）、这天真的没用过、
 *   以及「打开过但每次都不到 1 分钟」，三种都不是一句话能糊过去的。
 */
import { useMemo } from 'react';

import type { UsageSpan } from '../../types/domain/usage';
import {
  MIN_VISIBLE_SPAN_MS,
  mergeSpans,
  spanClockText,
  spanCountText,
  spanLengthCN,
  spanRawMillis,
} from './usageSpans';
import { formatSpanCN } from './usageFormat';

interface Props {
  spans: readonly UsageSpan[];
  /** 没有时段时说的话。**必填**：空态不许含糊（「系统已不再保留这天的明细」≠「这天没用」）。 */
  emptyHint: string;
  /** 这一天的合计秒数（同行 `sec`）。给了才能说清「列表加起来为什么比合计少」。 */
  totalSec?: number;
}

export function UsageSpanList({ spans, emptyHint, totalSec }: Props) {
  const all = useMemo(() => mergeSpans(spans), [spans]);
  const visible = useMemo(
    () => all.filter((span) => spanRawMillis(span) >= MIN_VISIBLE_SPAN_MS),
    [all],
  );
  const shortCount = all.length - visible.length;

  /* 缺口 = 合计 − 所有段加起来。0.12.8 起两者同源（总量就是这些段之和），所以**当天现算**
     出来的缺口一定是 0；这里留着是为了库里的历史：旧算法写下的合计与后来重算的段不是
     一批数据，或者系统已经回收了这天的明细，缺口可能有几小时。不说清楚的话，用户会以为
     时段列表算错了，或者以为总时长算错了。 */
  const gapSec = useMemo(() => {
    if (totalSec == null) return 0;
    const covered = all.reduce((sum, span) => sum + spanRawMillis(span), 0);
    return Math.max(0, Math.round(totalSec - covered / 1000));
  }, [all, totalSec]);

  if (visible.length === 0) {
    if (shortCount > 0) {
      return <p className="m-usage-spans__empty">这天打开过 {shortCount} 次，每次不到 1 分钟。</p>;
    }
    return <p className="m-usage-spans__empty">{emptyHint}</p>;
  }

  return (
    <section className="m-usage-spans">
      <div className="m-usage-spans__head">
        <span className="m-usage-spans__title">用它的时段</span>
        <span className="m-usage-spans__count">{spanCountText(visible.length)}</span>
      </div>
      <ol className="m-usage-spans__list">
        {visible.map((span) => (
          <li className="m-usage-spans__row" key={span.from}>
            <span className="m-usage-spans__clock">{spanClockText(span)}</span>
            <span className="m-usage-spans__len">{spanLengthCN(span)}</span>
          </li>
        ))}
      </ol>
      {shortCount > 0 ? (
        <p className="m-usage-spans__foot">另有 {shortCount} 次打开不到 1 分钟</p>
      ) : null}
      {gapSec >= 60 ? (
        <p className="m-usage-spans__foot">
          其余 {formatSpanCN(gapSec)}没有分段记录
          {/* 两种成因都说出来：这天的明细已被系统回收（约 7 天），或者当时长时间挂在
              同一个页面上、系统根本没产生切换事件。不说清楚的话，用户会以为时钟算错了。 */}
          （这天的明细已被系统回收，或当时长时间挂在同一个页面没有切换）
        </p>
      ) : null}
    </section>
  );
}
