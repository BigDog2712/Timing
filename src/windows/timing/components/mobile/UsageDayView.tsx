/**
 * [0.13.2] 统计页的「单日」视图：日期条 + 总览 + 洞察 + 排行。
 *
 * 从 `UsagePage` 抽出来的理由只有一个：那个文件已经顶到 300 行上限（`check:size`）。
 * 抽的时候顺手把「这一天怎么读」全留在这里，页面只负责取数与状态。
 */
import { UsageInsightList } from './UsageInsightList';
import { UsageOverview } from './UsageOverview';
import { UsageRanking } from './UsageRanking';
import { clockText, formatSpanCN, monthDayText } from './usageFormat';
import { topRows, type UsageRange } from '../../services/usageRange';
import type { Insight } from './usageInsights';

/** 排行最多显示多少行；其余合成「其他 N 个应用」（列表之和仍等于合计）。 */
export const RANK_LIMIT = 10;

interface Props {
  selectedKey: string;
  /** 今天（本地日键）：上界，也是「今日合计」的判据 */
  today: string;
  /** 这一天的读数（`rangeOf([dto])`）；没读到传 null */
  day: UsageRange | null;
  /** 这一天的失败原因（只影响这一天，不影响整页） */
  failure?: string;
  /**
   * 这一天被系统的事件上限截断了（[评审 P2-2]）：数字只是一部分。
   *
   * 单列一个 prop 而不是塞进 `UsageRange`：那个结构是**多天合并**的结果，
   * 「其中一天读不全」在合并后的对象上无处安放，塞进去只会让人以为整段时间都不完整。
   */
  truncated?: boolean;
  /** 与昨天比（秒）；null = 没读到昨天 */
  deltaSec: number | null;
  insights: readonly Insight[];
  onSelectDay: (key: string) => void;
  /** 日期条左右箭头：±1 天（日键算术留在页面，视图不认识日期） */
  onStepDay: (delta: number) => void;
  onSelectApp: (packageName: string) => void;
  onRetry: () => void;
}

export function UsageDayView({
  selectedKey,
  today,
  day,
  failure,
  truncated = false,
  deltaSec,
  insights,
  onSelectDay,
  onStepDay,
  onSelectApp,
  onRetry,
}: Props) {
  const isToday = selectedKey === today;
  const rows = day == null ? { top: [], rest: null } : topRows(day.rows, RANK_LIMIT);
  const firstUse = (day?.rows ?? []).reduce(
    (min, row) => (row.first > 0 && (min === 0 || row.first < min) ? row.first : min),
    0,
  );
  const lastUse = (day?.rows ?? []).reduce((max, row) => Math.max(max, row.last), 0);

  return (
    <>
      <div className="m-usage__daybar">
        <button
          type="button"
          className="m-usage__step"
          aria-label="前一天"
          onClick={() => onStepDay(-1)}
        >
          ‹
        </button>
        <label className="m-usage__datepick">
          {/* 原生日期控件压在文字上（透明）：点哪都能弹系统选择器，不自己造日历。
              字号 16px 是为了避开 iOS 聚焦时整页放大。 */}
          <input
            type="date"
            className="m-usage__dateinput"
            aria-label="选择日期"
            value={selectedKey}
            max={today}
            onChange={(event) => {
              const next = event.target.value;
              if (next !== '' && next !== selectedKey) onSelectDay(next);
            }}
          />
          <span className="m-usage__datetext">{monthDayText(selectedKey)}</span>
        </label>
        <button
          type="button"
          className="m-usage__step"
          aria-label="后一天"
          disabled={selectedKey >= today}
          onClick={() => onStepDay(1)}
        >
          ›
        </button>
      </div>

      {failure != null ? (
        <div className="m-usage__card">
          <p className="m-usage__hint">{failure}</p>
          <button type="button" className="m-btn" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : day == null ? (
        <p className="m-usage__hint">正在读取…</p>
      ) : day.totalSec === 0 ? (
        <p className="m-usage__hint">
          {isToday ? '今天还没有可统计的前台使用记录。' : '这天没有可统计的前台使用记录。'}
        </p>
      ) : (
        <>
          {truncated ? (
            /* [评审 P2-2] 系统一次最多读 2 万条事件，撞上上限时这一天的数只是一部分。
               宿主在这种情况下**不落库**（见 `usage_cmd`），所以这里显示的是库里上一份
               完整数据；用户需要知道的只有一件事：这次没读全，别把这天的数当真。 */
            <p className="m-usage__hint">
              这天的事件太多，系统一次只能读一部分：下面的数字不完整。
            </p>
          ) : null}
          <UsageOverview
            headline={isToday ? '今日合计' : '这天合计'}
            totalSec={day.totalSec}
            deltaSec={deltaSec}
            details={[
              { label: '首次', value: clockText(firstUse) },
              { label: '最后', value: clockText(lastUse) },
              { label: '应用', value: `${day.rows.length} 个` },
            ]}
          />
          <UsageInsightList items={insights} />
          <UsageRanking
            top={rows.top}
            rest={rows.rest}
            totalSec={day.totalSec}
            meta={(row) => {
              /* 段数打头：它回答的是「分几次用的」，比首末更能说明「点进去有东西看」。
                 段数为 0（老日期、系统已回收明细）就不提，免得写成「0 段 · 首次 09:00」。 */
              const parts: string[] = [];
              if (row.spanCount > 0) parts.push(`${row.spanCount} 段`);
              if (row.first > 0) {
                parts.push(`首次 ${clockText(row.first)} · 最后 ${clockText(row.last)}`);
              } else {
                parts.push(`合计 ${formatSpanCN(row.sec)}`);
              }
              return parts.join(' · ');
            }}
            onSelect={onSelectApp}
          />
          <p className="m-usage__note">只统计前台时间，息屏与后台播放不计。数据只留本机。</p>
        </>
      )}
    </>
  );
}
