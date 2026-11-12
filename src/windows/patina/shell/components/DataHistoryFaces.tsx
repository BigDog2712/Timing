/**
 * [0.12.1 末] 数据视图的两个面：概览（图表）/ 历史（逐条 + 区间）。
 *
 * 为什么需要它：0.12.1 把侧栏下线、导航收成顶栏三区（主界面 / 数据 / 设置），
 * `history` 从此**没有入口** —— 唯一路径是「数据 → 趋势切到日档 → 点某天的柱子」。
 * 0.12.1 末上线的历史区间视图（昨日 / 本周 / 近 7 天 / 近 30 天 / 自定义）因此等于
 * 埋在看不见的地方，用户打开「数据」只会看到老样子。
 *
 * 口径：**一个页面两副面孔**。`data` 与 `history` 两个 view 都渲染本组件，只差 `active`；
 * 点面签 = 导航到另一个 view（`onSelect`），组件内部**不持状态**。三条理由：
 *
 *   1. **单一真源**：高亮只跟 `currentView` 走。`onOpenHistoryDate`（数据页点柱子）、
 *      托盘/悬浮条递来的落点、`updateRelaunchViewStorage` 的恢复全都会自动一致，
 *      不会出现「面签亮着概览、内容却是历史」这种只有手测才发现的错位。
 *   2. **不并排挂载**：非活动面直接不渲染。数据页与历史页各自拉全套快照与聚合
 *      （历史单日那套 60+ 个 hook），同时挂等于一进页面就把同一批库查两遍。
 *   3. **零新文案**：两面签复用 `uiText.data.title` / `uiText.history.title`，
 *      不碰 `shared/i18n` —— 那边是按索引对齐的位置数组，且 `generated/contract.ts`
 *      冻结在 1131/1131，加一个键就撞棘轮。
 *
 * 面签用 `QuietSegmentedFilter`（`semantics="tabs"`）：这两个面确实是「同一上下文换面板」，
 * 与顶栏三区（站点级目的地，用 `aria-current`）是两种语义，别混。
 */
import type { ReactNode } from "react";
import QuietSegmentedFilter from "../../shared/components/QuietSegmentedFilter.tsx";
import type { View } from "../types/view.ts";

/** 数据视图的两个面。与 `View` 的 `data` / `history` 一一对应，不走新枚举。 */
export type DataFace = "data" | "history";

interface Props {
  active: DataFace;
  labels: Record<DataFace, string>;
  /** 面签被点：切到对应 view（由 AppShell 的导航统一处理落点与脏确认） */
  onSelect: (view: View) => void;
  dataNode: ReactNode;
  historyNode: ReactNode;
}

export default function DataHistoryFaces({
  active,
  labels,
  onSelect,
  dataNode,
  historyNode,
}: Props) {
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col gap-3 md:gap-4 overflow-hidden"
      data-data-face={active}
    >
      <div className="flex flex-0-0-auto items-center">
        <QuietSegmentedFilter<DataFace>
          value={active}
          semantics="tabs"
          options={[
            { value: "data", label: labels.data },
            { value: "history", label: labels.history },
          ]}
          /* 读屏名由两个面名拼成（「数据 / 历史」）：不新增文案，也不让 tablist 无名 */
          ariaLabel={`${labels.data} / ${labels.history}`}
          onChange={(next) => onSelect(next)}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-data-face-body={active}>
        {active === "history" ? historyNode : dataNode}
      </div>
    </div>
  );
}
