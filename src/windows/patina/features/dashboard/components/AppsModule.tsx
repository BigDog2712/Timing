import { useCallback, useMemo, useState } from "react";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { formatDashboardDuration, type TopApplicationItem } from "../services/dashboardFormatting.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { ReactNode } from "react";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import QuickClassificationEntry from "../../classification/components/QuickClassificationEntry.tsx";
import { useQuickClassificationLauncher } from "../../classification/hooks/useQuickClassificationLauncher.ts";
import {
  createQuickAppClassificationTarget,
  getQuickClassificationTargetKey,
  type QuickClassificationItemBinding,
} from "../../classification/types.ts";
import { useAppItemBindings } from "../hooks/useAppItemBindings.ts";

/**
 * 模块 3 · 应用排行（01 §4.2：数据复用 `topApplications` + `icons`，UI 重写）
 *
 * 旧形态是"卡中卡"（每行一张 `.qp-panel` + 100×6 进度条），新形态是**裸排行**：
 * 行 = `grid 24px / 1fr / 52px`，行高走 `--qp-row-app`（视觉层 32 → 28）。
 * [视觉层 0.12.x] 行间那 2px 发丝已删，图标 20 → 22、圆角 5 → 6、底色升到 raise 层。
 *
 * ## 行**可编辑**：双击 / 回车 / 右键都能打开快捷编辑（0.12.1 补回）
 *
 * 编辑走的是既有的快捷分类弹层（`useQuickClassificationLauncher` + `QuickClassificationEntry`，
 * 数据页与历史页用的是同一套），内容 = 改分类 / 改名 / **绑定指定事项**。
 * 卡底 footer「全部分类…」仍然是**分类映射视图**的入口（逐应用改类别/颜色/名字 + 全局筛选），
 * 两条路径不互相取代：行入口只解决「就这一个应用，顺手改一下」，映射视图解决「整体过一遍」。
 *
 * 键盘可达是硬要求（只用双击的入口对键盘用户等于没有）：行上是
 * `tabIndex=0` + `role="button"`，Enter / 空格 / `Shift+F10` 打开，右键同效。
 *
 * 历史判据（别抹）：旧行曾有三条隐藏路径（双击 → 目标详情、右键/Shift+F10 → 快捷分类、
 * Enter → 详情），上一轮**收口**时被判定「卡底 footer 已覆盖分类，目标详情在历史区/数据区
 * 另有入口」（02 §3.7：删承载物之前，被删的每条路径都要有第二个出口），于是行改成只读。
 * 本轮把行入口加回来，但**只加编辑**，不恢复「双击进目标详情」—— 那条仍然只在历史区/数据区。
 *
 * 已知取舍（A2，本轮不改）：行用 `role="button"` 换取键盘可达，代价是 `ul` 里 0 个
 * `listitem`。若要修，走「`li` 保留 listitem + 内部撑满行的 `button`」
 * （参考 `QuietTimelineTrack.tsx`），属独立改造（会动 19px / 4px 行几何与既有 12 条测试）。
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
  /* 卡头读数是**全部应用的合计**（exe `meta(Apps)` = `dur(apps_total_ms)`），
     不是被卡片高度裁剩的那几条之和 —— 那两个数在窄卡上会差很多。 */
  const totalDuration = applications.reduce((sum, app) => sum + Math.max(0, app.duration), 0);
  const state = moduleState(status, refreshError, visible.length === 0);

  /* 弹层是懒加载的（`QuickClassificationEntry` 内部 `lazy`），但钩子挂在卡上：
     `openAtElement` 会先 `preload()` 再开，所以首屏不含 385 行的 Surface。 */
  const { request, openAtElement, close } = useQuickClassificationLauncher();
  const { bindings, items, itemsLoadFailed, setBinding } = useAppItemBindings();
  const [editError, setEditError] = useState<string | null>(null);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const bindingLabels = useMemo<QuickClassificationItemBinding["labels"]>(() => ({
    entry: copy.bindItem,
    none: copy.noBinding,
    menuLabel: copy.itemMenuLabel,
    loadFailed: copy.itemsLoadFailed,
    empty: copy.itemsEmpty,
    saveFailed: copy.saveFailed,
  }), [copy]);

  const editingApp = request && request.target.kind === "app" ? request.target : null;
  const itemBinding = useMemo<QuickClassificationItemBinding | undefined>(() => {
    if (!editingApp) return undefined;
    return {
      itemId: bindings[editingApp.exeName] ?? null,
      items,
      loadFailed: itemsLoadFailed,
      labels: bindingLabels,
      onSave: (itemId) => setBinding(editingApp.exeName, itemId),
    };
  }, [bindings, editingApp, items, itemsLoadFailed, bindingLabels, setBinding]);

  const openEditor = useCallback((app: TopApplicationItem, row: HTMLElement) => {
    if (!app.exeName.trim()) return;
    setEditError(null);
    openAtElement(
      createQuickAppClassificationTarget({
        exeName: app.exeName,
        displayName: app.name,
        /* `TopApplicationItem` 没有 category 字段（它是排行读数，不是分类记录），
           所以这里按 exe 问一次映射表 —— 与 `buildTopApplications` 用的是同一个口径。 */
        category: AppClassification.mapApp(app.exeName, { appName: app.name }).category,
      }),
      row,
    );
  }, [openAtElement]);

  const handleEditError = useCallback((message: string) => setEditError(message), []);

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
      meta={copy.appsMeta(formatDashboardDuration(totalDuration))}
    >
      <ul className="qp-app-list qp-scroll-region qp-scroll-region-stable">
        {visible.map((app) => {
          /* 查表用**归一后**的键（与写侧 `resolveStatisticalApp` 同一个函数）：
             `TopApplicationItem.exeName` 来自 `AppStat.exeName`，会保留记录时的原始大小写
             （`Code.exe`），而 KV 里的键是 `code.exe` —— 直接拿原始 exe 查，就是绑定存上了、
             行上却没有标记（0.12.1 S1）。 */
          const boundItemId = bindings[AppClassification.resolveStatisticalApp(app.exeName)];
          const bound = boundItemId === undefined ? undefined : itemsById.get(boundItemId);
          return (
            <li
              key={app.exeName}
              className="qp-app-row"
              role="button"
              tabIndex={0}
              aria-haspopup="menu"
              /* 两段都是完整句子，中间必须有分隔符：只用一个空格时英文会粘成
                 「Edit VS Code Bound to: X」（分隔符走文案表，四语言各一种）。 */
              aria-label={bound
                ? `${copy.editApp(app.name)}${copy.rowLabelJoiner}${copy.boundTo(bound.name)}`
                : copy.editApp(app.name)}
              title={bound ? copy.boundTo(bound.name) : app.name}
              /* 双击前 preventDefault：否则连点两下会把下面的名字选中，弹出蓝色选区。 */
              onDoubleClick={(event) => {
                event.preventDefault();
                openEditor(app, event.currentTarget);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openEditor(app, event.currentTarget);
              }}
              onKeyDown={(event) => {
                const opensEditor = event.key === "Enter"
                  || event.key === " "
                  || event.key === "Spacebar"
                  || (event.key === "F10" && event.shiftKey);
                if (!opensEditor) return;
                event.preventDefault();
                openEditor(app, event.currentTarget);
              }}
            >
              <span className="qp-app-icon" aria-hidden="true">
                {icons[app.exeName]
                  ? <img src={icons[app.exeName]} alt="" />
                  : app.categoryInitial}
              </span>
              {/* 名称与绑定标记同处第二列：`minmax(0,1fr)` + 各自省略号，
                  卡宽拖到 w=1（约 300px）时也不横向滚动、不挤变形时长列。 */}
              <span className="qp-app-label">
                <span className="qp-app-name">{app.name}</span>
                {bound ? (
                  <span className="qp-app-binding" aria-hidden="true">
                    <span
                      className="qp-app-binding-dot"
                      style={bound.color ? { background: bound.color } : undefined}
                    />
                    <span className="qp-app-binding-name">{bound.name}</span>
                  </span>
                ) : null}
              </span>
              <span className="qp-app-value" title={`${app.percentage}%`}>
                {formatDashboardDuration(app.duration)}
              </span>
              {/* 行底那根 4px 占比条（Rust `apps.rs:57` 的 `kit::progress`）：宽度按百分比，
                  对读屏隐藏 —— 同一份占比已经写在 `title` 与卡头读数里。 */}
              <span className="qp-app-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(0, app.percentage))}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
      {/* 编辑失败的内联提示：主界面没有全局 toast 通道（`pushToast` 挂在 AppShell，
          而 `AppShell.tsx` 是冻结行数），所以这一卡自己说一句，下一次打开编辑器时清掉。 */}
      {editError ? <p className="qp-app-notice" role="status">{editError}</p> : null}
      {/* 底注照 exe（`apps.rs:80-92`）：分隔线 + 一行 10.5 的汇总。这行同时是
          「分类映射」的入口（exe 里它只是文字），点它仍然去映射视图。 */}
      <button type="button" className="qp-card-footer" onClick={onOpenMapping}>
        {copy.appsSummary(applications.length, formatDashboardDuration(totalDuration))}
      </button>
      {/* 弹层本身挂在本卡内（懒加载）：`key` 带上锚点坐标 —— 换一个应用要重挂，
          否则 `QuickClassificationSurface` 里那些 `useState` 初值会沿用上一条。 */}
      {request ? (
        <QuickClassificationEntry
          key={`${getQuickClassificationTargetKey(request.target)}:${request.anchor.clientX}:${request.anchor.clientY}`}
          request={request}
          onClose={close}
          onSaved={() => setEditError(null)}
          onError={handleEditError}
          itemBinding={itemBinding}
        />
      ) : null}
    </ModuleShell>
  );
}
