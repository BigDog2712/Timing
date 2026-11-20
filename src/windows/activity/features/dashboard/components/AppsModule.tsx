import { useCallback, useMemo, useState } from "react";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { formatDashboardDuration, type TopApplicationItem } from "../services/dashboardFormatting.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import { TOOL_TAG_COPY } from "../copyToolTag.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import type { ReactNode } from "react";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import AppTagDialog from "./AppTagDialog.tsx";
import { useAppItemBindings } from "../hooks/useAppItemBindings.ts";

/**
 * 模块 3 · 应用排行（01 §4.2：数据复用 `topApplications` + `icons`，UI 重写）
 *
 * 旧形态是"卡中卡"（每行一张 `.at-panel` + 100×6 进度条），新形态是**裸排行**：
 * 行 = `grid 24px / 1fr / 52px`，行高走 `--at-row-app`（视觉层 32 → 28）。
 * [视觉层 0.12.x] 行间那 2px 发丝已删，图标 20 → 22、圆角 5 → 6、底色升到 raise 层。
 *
 * ## 行**可编辑**：双击 / 回车 / 右键打开**标签编辑**（[0.12.4] 起不再是分类）
 *
 * 原来的「快捷分类弹层」（改分类 / 改名 / 绑定事项）整条下线：分类这个单一维度
 * 由标签取代，行入口只做一件事 —— 给这个应用挂标签（`AppTagDialog`，写
 * `__app_override::<exe>.tags`）。改名 / 绑定事项 / 排除统计等整体操作仍在
 * 卡底 footer 指向的映射视图里，两条路径分工不变。
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
  /** 卡底 footer → 应用映射视图（AppShell 的 handleSidebarNavigate("mapping")） */
  onOpenMapping: () => void;
  /** 标签保存成功后给上层一个「映射变了」的信号（颜色/筛选要重算） */
  onTagSaved?: () => void;
}

export default function AppsModule({
  controls,
  applications,
  icons,
  status,
  refreshError,
  onRetry,
  onOpenMapping,
  onTagSaved,
}: Props) {
  const UI_TEXT = useLocaleText();
  const copy = DASHBOARD_COPY[useLocale()];
  /* [0.12.6 · P0-9] 行上「工具」标记的文案：单独一张表（`copy.ts` 已被另一位工程师占着） */
  const toolCopy = TOOL_TAG_COPY[useLocale()];
  const visible = applications.slice(0, 5);
  /* 卡头读数是**全部已计入统计的应用**的合计（exe `meta(Apps)` = `dur(apps_total_ms)`
     的同一位置），不是被卡片高度裁剩的那几条之和 —— 那两个数在窄卡上会差很多。
     [M1] 工具类**不进**这个合计：它们的时长已经被读模型从总量/分类分布里扣掉了
     （`splitToolStats`），在这里再加回来，计时卡写「今日 1h」、这张卡头写 3h，
     用户只能判定"有一张卡在撒谎"，而他没有任何办法知道是哪一张。
     列表本身照旧**全量**（`visible` 吃 `applications`）：工具行还带着「工具」标记和
     自己的时长 —— 那是"我装了 IDM、它被标成工具了"的唯一出口，删了就没处查了。 */
  const totalDuration = applications.reduce(
    (sum, app) => sum + (app.isTool === true ? 0 : Math.max(0, app.duration)),
    0,
  );
  const state = moduleState(status, refreshError, visible.length === 0);

  const { bindings, items } = useAppItemBindings();
  const [editError, setEditError] = useState<string | null>(null);
  /* 双击打开的是**这一行**的标签编辑器；`tagVersion` 在保存后自增，让行上的标签
     重新按映射表取一遍（override 存在模块级静态表里，不随 props 变）。 */
  const [editing, setEditing] = useState<{ exeName: string; name: string } | null>(null);
  const [tagVersion, setTagVersion] = useState(0);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const openEditor = useCallback((app: TopApplicationItem) => {
    if (!app.exeName.trim()) return;
    setEditError(null);
    setEditing({ exeName: app.exeName, name: app.name });
  }, []);

  /* 每行的标签（保存后随 `tagVersion` 重取）。分类只在老数据里存在，
     由 `resolveAppTags` 回落成同名标签 —— 界面不再出现「分类」这个词。 */
  const tagsByExe = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const app of visible) map.set(app.exeName, AppClassification.getAppTags(app.exeName));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tagVersion 是"重取一次"的信号
  }, [visible, tagVersion]);

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
      <ul className="at-app-list at-scroll-region at-scroll-region-stable">
        {visible.map((app) => {
          /* 查表用**归一后**的键（与写侧 `resolveStatisticalApp` 同一个函数）：
             `TopApplicationItem.exeName` 来自 `AppStat.exeName`，会保留记录时的原始大小写
             （`Code.exe`），而 KV 里的键是 `code.exe` —— 直接拿原始 exe 查，就是绑定存上了、
             行上却没有标记（0.12.1 S1）。 */
          const boundItemId = bindings[AppClassification.resolveStatisticalApp(app.exeName)];
          const bound = boundItemId === undefined ? undefined : itemsById.get(boundItemId);
          const rowTags = tagsByExe.get(app.exeName) ?? [];
          /* 工具类（P0-9）：行上要有一个**看得见**的标记 —— 它的时长已经从总量/分布里
             拿掉了，不标的话用户唯一的感受就是"我的总时长怎么少了"，而且无处可查。
             标记只进 `title` / `aria-label`，不改行几何（见 `dashboard-apps.css`）。 */
          const isTool = app.isTool === true;
          const rowLabel = [
            copy.editApp(app.name),
            isTool ? toolCopy.toolHint : null,
            bound ? copy.boundTo(bound.name) : null,
          ].filter((part): part is string => part !== null).join(copy.rowLabelJoiner);
          return (
            <li
              key={app.exeName}
              className="at-app-row"
              role="button"
              tabIndex={0}
              aria-haspopup="menu"
              /* 两段都是完整句子，中间必须有分隔符：只用一个空格时英文会粘成
                 「Edit VS Code Bound to: X」（分隔符走文案表，四语言各一种）。 */
              aria-label={rowLabel}
              title={bound ? copy.boundTo(bound.name) : app.name}
              /* 双击前 preventDefault：否则连点两下会把下面的名字选中，弹出蓝色选区。 */
              onDoubleClick={(event) => {
                event.preventDefault();
                openEditor(app);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openEditor(app);
              }}
              onKeyDown={(event) => {
                const opensEditor = event.key === "Enter"
                  || event.key === " "
                  || event.key === "Spacebar"
                  || (event.key === "F10" && event.shiftKey);
                if (!opensEditor) return;
                event.preventDefault();
                openEditor(app);
              }}
            >
              <span className="at-app-icon" aria-hidden="true">
                {icons[app.exeName]
                  ? <img src={icons[app.exeName]} alt="" />
                  : app.categoryInitial}
              </span>
              {/* 名称与绑定标记同处第二列：`minmax(0,1fr)` + 各自省略号，
                  卡宽拖到 w=1（约 300px）时也不横向滚动、不挤变形时长列。 */}
              <span className="at-app-label">
                <span className="at-app-name">{app.name}</span>
                {isTool ? (
                  <span className="at-app-tool" title={toolCopy.toolHint}>
                    {toolCopy.toolBadge}
                  </span>
                ) : null}
                {rowTags.length > 0 ? (
                  <span className="at-app-tags" aria-hidden="true">
                    {rowTags.slice(0, 2).map((tag) => (
                      <span key={tag} className="at-app-tag">#{tag}</span>
                    ))}
                    {rowTags.length > 2 ? (
                      <span className="at-app-tag">+{rowTags.length - 2}</span>
                    ) : null}
                  </span>
                ) : null}
                {bound ? (
                  <span className="at-app-binding" aria-hidden="true">
                    <span
                      className="at-app-binding-dot"
                      style={bound.color ? { background: bound.color } : undefined}
                    />
                    <span className="at-app-binding-name">{bound.name}</span>
                  </span>
                ) : null}
              </span>
              <span className="at-app-value" title={`${app.percentage}%`}>
                {formatDashboardDuration(app.duration)}
              </span>
              {/* 行底那根 4px 占比条（Rust `apps.rs:57` 的 `kit::progress`）：宽度按百分比，
                  对读屏隐藏 —— 同一份占比已经写在 `title` 与卡头读数里。 */}
              <span className="at-app-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(0, app.percentage))}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
      {/* 编辑失败的内联提示：主界面没有全局 toast 通道（`pushToast` 挂在 AppShell，
          而 `AppShell.tsx` 是冻结行数），所以这一卡自己说一句，下一次打开编辑器时清掉。 */}
      {editError ? <p className="at-app-notice" role="status">{editError}</p> : null}
      {/* 底注照 exe（`apps.rs:80-92`）：分隔线 + 一行 10.5 的汇总。这行同时是
          「分类映射」的入口（exe 里它只是文字），点它仍然去映射视图。 */}
      <button type="button" className="at-card-footer" onClick={onOpenMapping}>
        {copy.appsSummary(applications.length, formatDashboardDuration(totalDuration))}
      </button>
      {/* 弹层本身挂在本卡内（懒加载）：`key` 带上锚点坐标 —— 换一个应用要重挂，
          否则 `QuickClassificationSurface` 里那些 `useState` 初值会沿用上一条。 */}
      {editing ? (
        <AppTagDialog
          key={editing.exeName}
          exeName={editing.exeName}
          displayName={editing.name}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditError(null);
            setTagVersion((version) => version + 1);
            onTagSaved?.();
          }}
          onError={handleEditError}
        />
      ) : null}
    </ModuleShell>
  );
}
