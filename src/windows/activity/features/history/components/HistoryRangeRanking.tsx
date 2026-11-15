import { formatDuration } from "../../../shared/lib/durationFormatting.ts";

/**
 * 区间排行榜（应用 / 事项共用一张）。
 *
 * 列表**不截断**，整块滚动：截成 Top 8 就得再补一句"还有 N 项"，
 * 而那句在不同语言里要做复数，收益却只是少滚两下。行高固定，滚动区高度由样式定。
 * 条形长度用 `share`（占本类合计的比例），不用相对第一名的比例——
 * 后者会让"第一名永远满格"，看不出到底占了多少。
 */
export interface HistoryRangeRankRow {
  key: string;
  name: string;
  durationMs: number;
  share: number;
  meta?: string;
}

interface Props {
  title: string;
  emptyLabel: string;
  rows: HistoryRangeRankRow[];
  /** `data-*` 钩子：两条排行卡用不同值，便于判据分别定位 */
  scope: string;
}

export default function HistoryRangeRanking({ title, emptyLabel, rows, scope }: Props) {
  return (
    <section className="qp-panel p-5 history-range-ranking" data-history-range-ranking={scope}>
      <header className="history-range-card-head">
        <h3 className="history-range-card-title">{title}</h3>
        <span className="history-range-card-meta">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="history-range-empty">{emptyLabel}</p>
      ) : (
        <ul className="history-range-rank-list qp-scroll-region">
          {rows.map((row) => (
            <li key={row.key} className="history-range-rank-row" data-history-range-rank-row>
              <span className="history-range-rank-name" title={row.name}>{row.name}</span>
              <span className="history-range-rank-track">
                <span
                  className="history-range-rank-fill"
                  style={{ width: `${Math.max(1, Math.round(row.share * 100))}%` }}
                />
              </span>
              <span className="history-range-rank-value">
                {formatDuration(row.durationMs)}
                {row.meta ? <span className="history-range-rank-meta"> · {row.meta}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
