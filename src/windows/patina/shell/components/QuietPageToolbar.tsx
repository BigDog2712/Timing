/**
 * 页级工具条容器（dashboard 与 settings 共用**几何与淡显**，不共用按钮皮）
 * -----------------------------------------------------------------------------
 * 需求 4 的原话是「设置页的保存/取消与主界面工具条统一」。统一落在**容器**这一维：
 * 位置（贴页面上沿、绝对定位、不抢内容几何）、常驻 `opacity: .45` + hover/focus 全显、
 * 与内容同一条基线。**不是**把设置页的 `QuietButton` 换成 `qp-link-btn`：
 *   · `qp-link-btn` 没有边框 / 底色 / 最小高，在设置页那种满屏输入控件的密度里
 *     读不出「这是最后一步」；
 *   · 它比 `QuietButton` 矮 34→~16px，误触成本直接落到「改错设置」。
 * 所以设置页仍然用 `QuietButton`（`tone="primary"` / `secondary`），只是挂进这个容器。
 *
 * 为什么要有这个组件而不是各自写一个 div：`.qp-page-toolbar` 那套规则原来只存在于
 * `.qp-dashboard-toolbar`（`dashboard-layout.css`），settings 要复用它就得复制一份几何，
 * 而复制出来的两份迟早会漂（本仓已经踩过一次：`scroll-margin-top: 60` 与
 * `ACTIVE_OFFSET = 56` 两个手抄常量）。
 *
 * **锁定态不许给它加 `pointer-events: none`**：锁定后工具栏必须仍可点，否则用户永久
 * 解不开锁（只能去删 localStorage）。判据见 `DashboardBoard.test` 的 V-1.3c。
 */
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 位置修饰类（如 `qp-dashboard-toolbar` 贴板子左上角）；几何全在 `.qp-page-toolbar` 上 */
  modifier?: string;
  /** 无障碍名字（读屏用户听到「工具条」才知道这组键是一个整体） */
  ariaLabel?: string;
}

export default function QuietPageToolbar({ children, modifier, ariaLabel }: Props) {
  const className = modifier ? `qp-page-toolbar ${modifier}` : "qp-page-toolbar";
  return (
    <div className={className} role="toolbar" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
