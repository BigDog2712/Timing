import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatDashboardDuration, type TopApplicationItem } from "../services/dashboardFormatting.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { ReactNode } from "react";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/**
 * 模块 3 · 应用排行（01 §4.2：数据复用 `topApplications` + `icons`，UI 重写）
 *
 * 旧形态是"卡中卡"（每行一张 `.qp-panel` + 100×6 进度条），新形态是**裸排行**：
 * 行 = `grid 22px / 1fr / 44px`，行高走 `--qp-row-app`（视觉层 32 → 28）。
 * [视觉层 0.12.x] 行间那 2px 发丝已删，图标 20 → 22、圆角 5 → 6、底色升到 raise 层。
 *
 * ## 行不再可点（这是设计的选择，不是偷懒）
 *
 * 旧行有三条隐藏路径：双击 → 目标详情、右键/Shift+F10 → 快捷分类、Enter → 详情。
 * 新设计把"分类"这条收口到卡底**通栏 footer「全部分类…」**（01 §4.3 骨架里唯一的按钮），
 * 于是：
 *   · 分类 → `onOpenMapping()`（分类映射视图，逐应用可改类别/颜色/名字）
 *   · 目标详情 → 历史区 / 数据区的同名入口（这两处本来就有）
 * 02 §3.7 要求"删承载物之前，被删的每条路径都要有第二个出口" —— 上面两条都成立，
 * 且 footer 还多给了一条直达。行本身保持只读，因此也不需要 24×24 命中区的键盘化改造。
 */
interface Props {
  controls?: ReactNode;
  applications: TopApplicationItem[];
  icons: Record<string, string>;
  /** 快照源的同一个 `status`（E2/E3 都由它派生，不另算） */
  status: LoadStatus;
  /** 快照失败但仍有数据 = E3（卡头小图标） */
  refreshError: boolean;
  onRetry: () => void;
  /** 「全部分类…」→ 分类映射视图（AppShell 的 handleSidebarNavigate("mapping")） */
  onOpenMapping: () => void;
}

export default function AppsModule({ controls, applications, icons, status, refreshError, onRetry, onOpenMapping }: Props) {
  const UI_TEXT = useLocaleText();
  const copy = DASHBOARD_COPY[useLocale()];
  const visible = applications.slice(0, 5);
  const state = moduleState(status, refreshError, visible.length === 0);

  return (
    <ModuleShell
      controls={controls}
      id="t-apps"
      title={UI_TEXT.dashboard.topApps}
      state={state}
      skeletonRows={5}
      skeletonRow="app"
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={onRetry}
      refreshErrorText={refreshError ? UI_TEXT.common.refreshFailed : undefined}
      emptyText={copy.appsEmpty}
      meta={copy.appsTop(visible.length)}
    >
      <ul className="qp-app-list qp-scroll-region qp-scroll-region-stable">
        {visible.map((app) => (
          <li key={app.exeName} className="qp-app-row">
            <span className="qp-app-icon" aria-hidden="true">
              {icons[app.exeName]
                ? <img src={icons[app.exeName]} alt="" />
                : app.categoryInitial}
            </span>
            <span className="qp-app-name" title={app.name}>{app.name}</span>
            <span className="qp-app-value" title={`${app.percentage}%`}>
              {formatDashboardDuration(app.duration)}
            </span>
            {/* [视觉层 0.12.x] 2px 发丝（`<span className="hair" />`）已删：行高 32 → 28 之后
                5 行只占 140，再加 4 条线会把"行"读成"表格"。行间分隔交给行高差与图标底块。
                发丝从来不是数据通道（几何表只给了 2px/radius 0，没给颜色），删掉不丢信息。 */}
          </li>
        ))}
      </ul>
      <button type="button" className="qp-card-footer" onClick={onOpenMapping}>
        {copy.appsFooter}
      </button>
    </ModuleShell>
  );
}
