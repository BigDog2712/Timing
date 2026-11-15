import type { ReactNode, Ref } from "react";

/**
 * 应用趋势面板的**加载骨架**（[本轮] 从 `DataAppTrendPanel` 按语义拆出来）。
 *
 * 为什么拆：面板这个文件被 size 门禁冻在 518 行（只许减不许加），而本轮要给它接
 * 「双击打开应用设置」——一行都不许涨。这块骨架本来就自成一体（一段纯占位 DOM，
 * 没有任何交互与状态），搬出来最干净。
 *
 * **类名与结构逐字保留**：`data-app-grid` / `data-app-sidebar` / `data-app-chart-column`
 * 那几层是版式约定的锚点（`data.css` 里按它们排版），改一个字就会在"首屏还没数据"
 * 的那一瞬闪出一个版式不同的空壳。
 */
interface Props {
  /** 图表占位要挂到真图表的 ref 上：首屏量出来的宽高直接给真图表用，避免二次布局 */
  chartRef: Ref<HTMLDivElement>;
  /** 热力图占位（同样是"位置先占住"） */
  heatmapContent: ReactNode;
  loadingLabel: string;
  metricCount?: number;
}

export default function DataAppTrendSkeleton({
  chartRef,
  heatmapContent,
  loadingLabel,
  metricCount = 4,
}: Props) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" aria-busy>
      <div role="status" className="absolute qp-text-caption text-[var(--qp-text-tertiary)]">{loadingLabel}</div>
      <div className="data-app-grid pointer-events-none invisible" aria-hidden>
        <div className="data-app-sidebar" data-hint="">
          <div className="data-app-search" />
          <div className="data-app-list data-app-trend-list qp-scroll-region" />
        </div>
        <div className="data-app-chart-column">
          <div className="data-app-metric-strip">
            {Array.from({ length: metricCount }, (_, index) => (
              <div className="data-app-metric" key={index}>
                <span>-</span>
                <strong>-</strong>
              </div>
            ))}
          </div>
          <div ref={chartRef} className="data-app-chart data-chart-placeholder" />
          {heatmapContent}
        </div>
      </div>
    </div>
  );
}
