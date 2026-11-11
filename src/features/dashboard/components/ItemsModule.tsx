import { useActivityDisplayColor } from "../../../shared/hooks/useActivityDisplayColor.ts";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatDashboardDuration, type TopItemEntry } from "../services/dashboardFormatting.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/**
 * 模块 2 · 事项分布（01 §4.2：纯新增，无旧资产）
 *
 * 行 = `grid 6px / 1fr / 60px(裸条) / 44px`（几何表 item 30 高，两档同值；
 * 短档只有 `--qp-row-items` 26 影响行高，裸条自己也跟着 `--qp-bar-max` 48 缩）。
 *
 * 「今日 N 项」现在是**不可点的文本**：设计里它是入口，但事项的完整列表在
 * 数据管理区（另一个视图，且它的行模型是 session 不是 title），本轮没有目标可跳。
 * 做成假按钮比不做更糟（点了没反应），所以按 `qp-card-meta` 只显示条数。
 *
 * 两段式卡头：**第一段常驻**（`今日 N 项`，N = 截断前的总数），**第二段只在溢出时出现**
 * （`更多 K 项 ▸`）。两个数都从 `buildTopItems` 的 `total` 来 —— 用 `items.length` 的话
 * N 恒等于 6，是一句永远正确的假话。
 */
interface Props {
  items: TopItemEntry[];
  /** 截断前的总数（`buildTopItems(...).total`），卡头第一段用它 */
  total: number;
  /** 快照源的同一个 `status`（E2/E3 都由它派生，不另算） */
  status: LoadStatus;
  /** 快照失败但仍有数据 = E3（卡头小图标） */
  refreshError: boolean;
  onRetry: () => void;
}

export default function ItemsModule({ items, total, status, refreshError, onRetry }: Props) {
  const displayColor = useActivityDisplayColor();
  const UI_TEXT = useLocaleText();
  const copy = DASHBOARD_COPY[useLocale()];
  const state = moduleState(status, refreshError, items.length === 0);
  /* 裸条按**最大项**归一，不按占总量百分比：6 项摊开时头部一项常常只有 10%，
   * 60px × 10% = 6px，六行会全变成一排小横杠（探针实测 10.19/9.00/8.39/7.80/6.59/6.00）。
   * 归一后最长那项吃满 60px，读的是"谁比谁长"，这正是裸条存在的理由。
   * 真实占比仍以右侧时长为准（title 里有百分比）。 */
  const max = items.reduce((peak, item) => Math.max(peak, item.duration), 0);

  return (
    <ModuleShell
      id="t-items"
      title={copy.itemsTitle}
      state={state}
      skeletonRows={6}
      skeletonRow="items"
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={onRetry}
      refreshErrorText={refreshError ? UI_TEXT.common.refreshFailed : undefined}
      emptyText={copy.itemsEmpty}
      meta={(
        <>
          <span>{copy.itemsCount(total)}</span>
          {total > items.length ? <span>{copy.itemsMore(total - items.length)}</span> : null}
        </>
      )}
    >
      <ul className="qp-item-list qp-scroll-region qp-scroll-region-stable">
        {items.map((item) => (
          <li key={item.title} className="qp-item-row">
            <span
              className="qp-readout-dot"
              aria-hidden="true"
              style={{ backgroundColor: displayColor(item.color) || "var(--qp-accent-default)" }}
            />
            <span className="qp-item-name" title={item.title}>{item.title}</span>
            {/* 裸条：aria-hidden —— 占比已经由右侧时长与环表达，读屏再念一个空条无意义 */}
            <span className="qp-item-bar" aria-hidden="true" style={{ color: displayColor(item.color) || "var(--qp-accent-default)" }}>
              <span style={{ width: `${max > 0 ? Math.max(2, (item.duration / max) * 100) : 0}%` }} />
            </span>
            <span className="qp-readout-value" title={`${item.percentage}%`}>
              {formatDashboardDuration(item.duration)}
            </span>
          </li>
        ))}
      </ul>
    </ModuleShell>
  );
}
