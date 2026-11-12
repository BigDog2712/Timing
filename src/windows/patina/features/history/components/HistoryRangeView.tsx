import type { ReactNode } from "react";
import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import type { HistoryRangeDataState } from "../hooks/useHistoryRangeData.ts";
import type { HistoryRangeCopy } from "../rangeCopy.ts";
import HistoryRangeRanking, { type HistoryRangeRankRow } from "./HistoryRangeRanking.tsx";
import HistoryRangeRecords from "./HistoryRangeRecords.tsx";
import HistoryRangeSummary from "./HistoryRangeSummary.tsx";
import HistoryRangeTimeline from "./HistoryRangeTimeline.tsx";

/**
 * 区间总览（历史页 `mode !== "day"` 时**替换**单日主体）。
 *
 * 为什么不把单日那根 0–24h 的轴直接留在上面：它只能画"选中的某一天"，
 * 与下面的区间数字不同轴，用户会以为那根轴就是整个区间的形状。
 * 区间另有一份**逐日时间轴**（`HistoryRangeTimeline`，一行一天，横轴各自 0–24h）：
 * 看整体形状看它，看某一天的细节点逐日柱或点行首回单日 —— 两层各有明确职责。
 *
 * 三种态：
 *   · 首载无数据 → 一句「正在统计…」（不做骨架：四块结构不同，骨架反而跳）；
 *   · 有数据 + 刷新中 → 继续显示旧数（不清空、不闪，0.12.1 的刷新纪律）；
 *   · 四类数据全读失败 → 一句失败 + 重试按钮。
 */
interface Props {
  copy: HistoryRangeCopy;
  uiText: UiText;
  locale: Locale;
  data: HistoryRangeDataState;
  onOpenDay: (dateKey: string) => void;
  /** 单日档传 `false`：只有一天，逐日柱既不表达趋势，自己点自己也没意义 */
  showDailyBars?: boolean;
  /**
   * 逐日时间轴是否显示。单日档传 `false`：那一天已经有上面那根可缩放、可点段的交互时间轴，
   * 再画一行静止的带子是重复；区间档没有别的时序视图，所以默认显示。
   */
  showTimeline?: boolean;
  /** 单日档独有的额外块（每小时活动）——跟着同一块滚动区走，不另起一列 */
  extraBlock?: ReactNode;
}

export default function HistoryRangeView({
  copy,
  uiText,
  locale,
  data,
  onOpenDay,
  showDailyBars = true,
  showTimeline = true,
  extraBlock,
}: Props) {
  const { aggregate, loading, error, retry } = data;

  if (!aggregate && error) {
    return (
      <div className="qp-panel p-5 history-range-status" role="status" data-history-range-error>
        <span>{copy.readFailed}</span>
        <button type="button" className="qp-control" onClick={retry}>{uiText.common.retry}</button>
      </div>
    );
  }

  if (!aggregate) {
    return (
      <div className="qp-panel p-5 history-range-status" role="status" data-history-range-loading>
        <span>{copy.loading}</span>
      </div>
    );
  }

  const appRows: HistoryRangeRankRow[] = aggregate.apps.map((row) => ({
    key: row.key,
    name: row.name,
    durationMs: row.durationMs,
    share: row.share,
  }));
  const itemRows: HistoryRangeRankRow[] = aggregate.items.map((row) => ({
    key: String(row.itemId),
    name: row.name,
    durationMs: row.durationMs,
    share: row.share,
    meta: copy.itemRecordCount(row.recordCount),
  }));

  return (
    <div className="history-range-scroll qp-scroll-region qp-scroll-region-stable">
      {error && !loading ? (
        <div className="qp-panel history-range-refresh-error" role="alert">
          <span>{uiText.common.refreshFailed}</span>
          <button type="button" className="qp-control" onClick={retry}>{uiText.common.retry}</button>
        </div>
      ) : null}
      <div className="history-range-grid" data-history-range-ready>
        <HistoryRangeSummary
          aggregate={aggregate}
          copy={copy}
          uiText={uiText}
          locale={locale}
          onOpenDay={onOpenDay}
          showDailyBars={showDailyBars}
        />
        {showTimeline && aggregate.timeline.length > 0 ? (
          <HistoryRangeTimeline
            copy={copy}
            uiText={uiText}
            locale={locale}
            lanes={aggregate.timeline}
            onOpenDay={onOpenDay}
          />
        ) : null}
        <HistoryRangeRanking
          scope="apps"
          title={copy.appsTitle}
          emptyLabel={copy.appsEmpty}
          rows={appRows}
        />
        <HistoryRangeRanking
          scope="items"
          title={copy.itemsTitle}
          emptyLabel={copy.itemsEmpty}
          rows={itemRows}
        />
        <HistoryRangeRecords
          copy={copy}
          locale={locale}
          notes={aggregate.notes}
          todos={aggregate.todos}
        />
        {extraBlock ? (
          /* 横跨整行：单日的「每小时活动」跟着同一块滚动区走，不另起一列 */
          <div style={{ gridColumn: "1 / -1" }} data-history-range-extra>
            {extraBlock}
          </div>
        ) : null}
      </div>
    </div>
  );
}
