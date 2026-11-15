/**
 * [0.13.2] 统计页的「近 7 天」视图：区间总览 + 洞察 + 合并排行。
 *
 * 与单日视图分开的理由同 `UsageDayView`：一个文件只能装一件事，页面文件才不会顶穿 300 行。
 * 合并排行每行脚注是「出现 N 天」而不是「首次/最后」—— 跨天混排首末时刻会得到
 * 「首次周一 08:12 · 最后周日 23:41」这种看着像一天的说法。
 */
import { UsageInsightList } from './UsageInsightList';
import { UsageOverview } from './UsageOverview';
import { UsageRanking } from './UsageRanking';
import { formatDuration } from './usageFormat';
import { topRows, type UsageRange } from '../../services/usageRange';
import type { Insight } from './usageInsights';
import { RANK_LIMIT } from './UsageDayView';

interface Props {
  week: UsageRange;
  insights: readonly Insight[];
  onSelectApp: (packageName: string) => void;
}

export function UsageWeekView({ week, insights, onSelectApp }: Props) {
  if (week.totalSec === 0) {
    return <p className="m-usage__hint">这 7 天还没有可统计的前台使用记录。</p>;
  }
  const rows = topRows(week.rows, RANK_LIMIT);
  return (
    <>
      <UsageOverview
        headline="近 7 天合计"
        totalSec={week.totalSec}
        details={[
          { label: '日均', value: formatDuration(week.avgPerDaySec) },
          { label: '有数据', value: `${week.dayCount} 天` },
        ]}
      />
      <UsageInsightList items={insights} />
      <UsageRanking
        top={rows.top}
        rest={rows.rest}
        totalSec={week.totalSec}
        meta={(row) => `出现 ${row.days} 天`}
        onSelect={onSelectApp}
      />
      <p className="m-usage__note">
        系统只保留最近约 7 天明细；更早的日子来自本机已存下的汇总。只统计前台时间，息屏与后台播放不计。
      </p>
    </>
  );
}
