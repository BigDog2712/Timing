/**
 * [0.13.2] 单个应用的每日趋势（点排行里的一行进来）。
 *
 * 市面上的同类产品都有一条「点应用看它自己怎么用的」路径：总榜回答「谁最多」，
 * 详情回答「是每天都不少，还是某一天爆了」。这两个问题的答案完全不同。
 *
 * 与主趋势柱共用 `UsageTrend`：`null` 仍是「没读到」，不是 0 —— 详情页最容易在这里
 * 走偏（把没读到的天当 0 拉成一条谷），所以它和主页面用同一份点数据口径。
 */
import { useMemo } from 'react';

import { UsageSpanList } from './UsageSpanList';
import { UsageTrend, type UsageTrendPoint } from './UsageTrend';
import { UsageAppIcon } from './UsageAppIcon';
import { clockText, displayName, formatDuration, monthDayShort } from './usageFormat';
import type { UsageSpan } from '../../types/domain/usage';

interface Props {
  packageName: string;
  /** 系统给的真名；空则回落包名短名（见 `displayName`） */
  label?: string;
  /** `data:image/webp;base64,…`；空则画首字瓦片 */
  icon?: string;
  /** 该应用逐日（从旧到新），`null` = 那天没读到 */
  points: readonly UsageTrendPoint[];
  selected: string;
  onSelectDay: (key: string) => void;
  onBack: () => void;
  /** 选中那天的首末时刻（0 = 未知）；不给就不显示这一行 */
  firstLast?: { first: number; last: number } | null;
  /** 选中那天的使用时段（后端已合并；这里再归一一次） */
  spans?: readonly UsageSpan[];
}

export function UsageAppDetail({
  packageName,
  label,
  icon,
  points,
  selected,
  onSelectDay,
  onBack,
  firstLast,
  spans,
}: Props) {
  const title = displayName({ packageName, label });
  /* 空态必须分清两种空：老日期系统已回收明细（我们只记得合计），和这天真的没用。
     判据是「首末时刻有一个还在」—— `last` 来自系统的 `lastTimeUsed`，事件明细没了它也还在；
     只有两个都是 0 才是「真的没用过」。 */
  const used = firstLast != null && (firstLast.first > 0 || firstLast.last > 0);
  const spansHint = used
    ? '这一天的明细已不在系统里（系统只保留约 7 天），只剩当时记下的合计。'
    : '这天没有这个应用的前台记录。';
  /* 选中那天的合计秒数，用来给时段列表算「缺口」。`null` 是「没读到」而不是 0，
     所以转成 undefined 传给列表 —— 传 0 会让它算出「全部都没有记录」。 */
  const daySec = points.find((point) => point.key === selected)?.totalSec;

  const stats = useMemo(() => {    let total = 0;
    let count = 0;
    let longest: UsageTrendPoint | null = null;
    for (const point of points) {
      if (point.totalSec == null) continue;
      total += point.totalSec;
      count += 1;
      if (longest == null || point.totalSec > (longest.totalSec ?? 0)) longest = point;
    }
    return { total, count, avg: count > 0 ? Math.round(total / count) : 0, longest };
  }, [points]);

  return (
    <div className="m-usage">
      <div className="m-usage__daybar">
        <button type="button" className="m-usage__step" aria-label="返回排行" onClick={onBack}>
          ‹
        </button>
        <span className="m-usage-detail__title" title={packageName}>
          <UsageAppIcon label={title} icon={icon} />
          <span className="m-usage-detail__name">{title}</span>
        </span>
        <span className="m-usage-detail__placeholder" aria-hidden="true" />
      </div>

      <UsageTrend points={points} selected={selected} onSelect={onSelectDay} />

      <dl className="m-usage-overview__meta">
        <div className="m-usage-overview__cell">
          <dt>近 {points.length} 天合计</dt>
          <dd>{formatDuration(stats.total)}</dd>
        </div>
        <div className="m-usage-overview__cell">
          <dt>日均</dt>
          <dd>{formatDuration(stats.avg)}</dd>
        </div>
        <div className="m-usage-overview__cell">
          <dt>最久一天</dt>
          <dd>
            {stats.longest?.totalSec
              ? `${monthDayShort(stats.longest.key)} · ${formatDuration(stats.longest.totalSec)}`
              : '—'}
          </dd>
        </div>
      </dl>

      {/* `clockText(0)` 会画成「08:00」（1970-01-01 UTC），所以两个时刻都在才显示这一行；
          明细缺失时 `first` 会是 0，那是「不知道」而不是「零点」。 */}
      {firstLast != null && firstLast.first > 0 && firstLast.last > 0 ? (
        <p className="m-usage__hint">
          当天首次 {clockText(firstLast.first)} · 最后 {clockText(firstLast.last)}
        </p>
      ) : null}

      <UsageSpanList
        spans={spans ?? []}
        emptyHint={spansHint}
        totalSec={daySec ?? undefined}
      />

      <p className="m-usage__note">
        {stats.count === 0
          ? '这几天还没有这个应用的前台记录。'
          : `按 ${stats.count} 天前台上报的时间汇总。点柱子切到那一天。`}
      </p>
    </div>
  );
}
