import { useLocaleText } from "../../shared/i18n/index.ts";
import { useEffect, useRef, type CSSProperties } from "react";
import { BarChart3, Monitor, Settings2 } from "lucide-react";
import type { View } from "../types/view";

/**
 * 顶栏三区导航（01 §6 / 02 §2）。
 *
 * 语义裁定（02 §2.1）：这是**站点级目的地**，不是"同一上下文内换面板" →
 * `<nav>` + `<button aria-current="page">`，**不是** role="tablist"。
 * 两条不能改的理由：① 数据管理 / 设置各自还有内层面签，外层再用 tablist 会
 * 形成"tab 里套 tab"，屏幕阅读器与方向键都分不清在哪一层；② 本仓既有惯例
 * （AppSidebar 的 aria-current + 上次视图持久化 + 未保存确认）已经是 page 语义。
 *
 * 三区不做 roving（02 §2.2）：只有 3 项，roving 省下 2 次 Tab 换一个"看不见的
 * 隐藏 Tab 停点"不划算；aria-current 的导航也不暗示方向键。
 */

export interface AppTopNavProps {
  currentView: View;
  onPrepareNavigate?: (view: View) => boolean;
  onNavigate: (view: View) => boolean | void | Promise<boolean | void>;
  onPreviewNavigate?: (view: View) => void;
}

type TabStyle = CSSProperties & { "--qp-tab-i": number };

/**
 * View → 归属的顶栏区域（01 §6.6 归并表）。
 * 本轮只做**高亮映射**，视图归属的真正归并（数据管理三面 / 设置五组）在下一批。
 * 先把它写全，是为了避免"恢复了上次视图却没有 tab 点亮"这种看起来像 bug 的状态：
 * 启动时 last-active-view 可能是 history / mapping / about（另一个窗口递来的落点也可能是）。
 * tools 归主界面：工具是主界面的第二面，主界面 tab 保持点亮（01 §5.2）。
 */
const TAB_BY_VIEW: Record<View, View> = {
  dashboard: "dashboard",
  tools: "dashboard",
  history: "data",
  data: "data",
  mapping: "data",
  settings: "settings",
  about: "settings",
};

export default function AppTopNav({
  currentView,
  onPrepareNavigate,
  onNavigate,
  onPreviewNavigate,
}: AppTopNavProps) {
  const UI_TEXT = useLocaleText();
  const tabs = [
    { id: "dashboard" as View, icon: Monitor, label: UI_TEXT.dashboard.title },
    { id: "data" as View, icon: BarChart3, label: UI_TEXT.data.title },
    { id: "settings" as View, icon: Settings2, label: UI_TEXT.settings.title },
  ];
  const activeTab = TAB_BY_VIEW[currentView];
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const navigateRequestRef = useRef(0);
  const indicatorStyle: TabStyle = { "--qp-tab-i": Math.max(0, activeIndex) };

  const handleTabClick = (view: View) => {
    navigateRequestRef.current += 1;
    const requestId = navigateRequestRef.current;

    onPrepareNavigate?.(view);

    // 导航正确性不许挂在 rAF / timer 上：后台与无头 WebView 都会节流两者。
    // AppShell 会保留旧视图直到目标 chunk 就绪，所以这里直接提交既便宜又正确。
    if (navigateRequestRef.current !== requestId) return;
    void Promise.resolve(onNavigate(view));
  };

  useEffect(() => () => {
    navigateRequestRef.current += 1;
  }, []);

  return (
    <nav
      className="qp-topbar-nav"
      data-topbar-nav=""
      data-tab-active={activeIndex >= 0 ? "true" : "false"}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            // 预加载三触发照抄 AppSidebar（02 §2.4）：**不绑 click** —— 激活走 click，
            // 预载走 focus/mouseenter/pointerdown；幂等由 viewChunkPreloadService 保证。
            onFocus={() => onPreviewNavigate?.(tab.id)}
            onMouseEnter={() => onPreviewNavigate?.(tab.id)}
            onPointerDown={() => onPreviewNavigate?.(tab.id)}
            onClick={() => handleTabClick(tab.id)}
            aria-current={isActive ? "page" : undefined}
            data-topbar-tab={tab.id}
            className="qp-topbar-tab"
            /* 文字标签已下线（只留图标）：名字必须留在可访问名里，否则读屏只剩
               "按钮"三个字；`title` 给鼠标用户一条悬停提示，两者都不能省。 */
            aria-label={tab.label}
            title={tab.label}
          >
            <Icon aria-hidden="true" />
          </button>
        );
      })}
      <span className="qp-tab-ind pointer-events-none" style={indicatorStyle} aria-hidden="true" />
    </nav>
  );
}
