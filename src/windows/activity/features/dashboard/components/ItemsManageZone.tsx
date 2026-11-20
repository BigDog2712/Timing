/**
 * 「事项管理」卡 · **唯一的区**（0.12.6）。
 *
 * 两组列表（`services/itemPrefs.ts` 的两个纯函数就是分组口径的唯一实现）：
 *   · 常用事项 = `pinnedItems(items)`（`isPinned`，按 `sortOrder` 升序，置顶最前）
 *   · 历史事项 = `recentItems(items, recentCount)`（非置顶，按 `updatedAt` 倒序取前 N）
 *
 * 每行 = 名称 + 今日累计（`useTodayItems` 的 `value`，没有就不画） + 绑定标记
 * （`useAppItemBindings().bindings` 里有没有这个事项；**只说有没有**，不列具体应用 ——
 * 一行 12px 的标记塞不下清单，完整清单在应用视角） + 行点击起停（`itemTimer`）。
 *
 * ## 为什么排序 / 条数 / 置顶全走 `services/itemPrefs.ts`
 *
 * 宿主悬浮窗的「事项菜单」有一套同口径实现，两边漂了不会报错，只会让同一批数据在两个
 * 窗口里顺序不同。`itemPrefs.mirror.test.ts` 钉住常量同值，这里只负责画。
 *
 * ## 写动作一律不在这里发
 *
 * 新增 / 编辑 / 事项管理三个入口打开的是既有的 `TimelineManage` / `TimelineEditDialog`
 * （意图在那些组件里发，分析窗没有写命令）。本组件只决定**入口的位置**。
 * AI 一键分类自带按钮与预览层（`ItemsAiTagButton`），点击起停走 `itemTimer`（见
 * `hooks/useItemTimerToggle.ts`：方向在发信侧判、不做乐观切换）。
 */
import { Link2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToastPush } from "../../../shared/types/toast.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import { useAppItemBindings } from "../hooks/useAppItemBindings.ts";
import { useItemPrefs } from "../hooks/useItemPrefs.ts";
import type { ItemTimerToggle } from "../hooks/useItemTimerToggle.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import { useBoardInstance, withInstance } from "../layout/instanceContext.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import { pinnedItems, recentItems, type ItemPrefsLike } from "../services/itemPrefs.ts";
import ItemsAiTagButton from "./ItemsAiTagButton.tsx";
import { moduleState, type ModuleState } from "./ModuleShell.tsx";
import TimelineEditDialog from "./TimelineEditDialog.tsx";
import TimelineManage from "./TimelineManage.tsx";

/** 三个弹层的互斥态（`TimelineManage` 自己的 mode 只认 create / manage）。 */
type ManageDialogMode = "create" | "edit" | "manage" | null;

interface Props {
  /** 今日事项行：只取 `itemId → value` 做行上的「今日累计」 */
  todayRows: readonly TodayItemRow[];
  /** 「编辑事项」的候选（今日时间线顺序，`todayTimedItemIds` 的结果） */
  editableItemIds: readonly number[];
  /** 行点击起停（含当前会话挂在哪个事项上） */
  itemTimer: ItemTimerToggle;
  /** 分析窗的提示条出口（AI 结果 / 起停确认都走它） */
  onToast: ToastPush;
  onLocalRename: (itemId: number, name: string) => void;
  onLocalCreate: (name: string) => void;
}

export default function ItemsManageZone({
  todayRows,
  editableItemIds,
  itemTimer,
  onToast,
  onLocalRename,
  onLocalCreate,
}: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  /* 多实例：区标题 id 要带后缀（与 `ModuleShell` 同一口径） */
  const domId = withInstance("t-items-manage", useBoardInstance());
  const [dialog, setDialog] = useState<ManageDialogMode>(null);
  /* 上区是**常驻**的卡内容（不是弹层），所以 `active` 恒为 true：这两条读命令就是
     这一区的数据源。写动作仍全部在弹层里（`TimelineManage` 自己再取一份）。 */
  const { items, recentCount, showRecent, status, reload } = useItemPrefs(true);
  const { bindings } = useAppItemBindings();

  const todayTotals = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of todayRows) map.set(row.itemId, row.value);
    return map;
  }, [todayRows]);

  /* 绑定表是 `exeName → itemId`（并集主值）。这里要的是反过来的**集合**：
     行上只判"这个事项有没有绑定"。 */
  const boundItemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const itemId of Object.values(bindings)) ids.add(itemId);
    return ids;
  }, [bindings]);

  const pinned = pinnedItems(items);
  const recent = showRecent ? recentItems(items, recentCount) : [];
  const isEmpty = pinned.length === 0 && recent.length === 0;
  const state: ModuleState = moduleState(status, false, isEmpty);

  const renderRow = (item: ItemPrefsLike) => {
    const total = todayTotals.get(item.id) ?? 0;
    const bound = boundItemIds.has(item.id);
    /* 「正在计这一条」只认 running + 同一事项：暂停中的会话也算"当前这一条"，
       但点它的语义是**继续**，所以不能画成"正在计时"（红点会撒谎）。 */
    const running = itemTimer.status === "running" && itemTimer.sessionItemId === item.id;
    return (
      <li key={item.id} className="at-items-row" data-bound={bound || undefined} data-running={running || undefined}>
        <button
          type="button"
          className="at-items-row-main"
          aria-label={running ? copy.itemsStopTimer(item.name) : copy.itemsStartTimer(item.name)}
          onClick={() => itemTimer.toggleItem(item.id, item.name)}
        >
          <span className="at-items-row-name" title={item.name}>{item.name}</span>
          {total > 0 ? (
            <span className="at-items-row-today">{copy.timerToday(formatDashboardDuration(total))}</span>
          ) : null}
          {bound ? (
            <span className="at-items-row-bound" role="img" aria-label={copy.itemsBoundMark}>
              <Link2 size={11} strokeWidth={2} aria-hidden="true" />
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div
      className="at-items-zone at-items-zone-manage"
      data-zone="manage"
      data-state={state}
      aria-labelledby={domId}
    >
      {/* ── 区标题行：标题 + 四个动作。动作在四态之外常驻（读失败也要能新建） ── */}
      <div className="at-items-zone-head">
        <h3 className="at-items-zone-title" id={domId}>{copy.itemsManageTitle}</h3>
        <div className="at-items-zone-actions">
          <button type="button" className="at-link-btn" onClick={() => setDialog("create")}>
            {copy.itemsNewAction}
          </button>
          <button type="button" className="at-link-btn" onClick={() => setDialog("edit")}>
            {copy.timelineEditItem}
          </button>
          <button type="button" className="at-link-btn" onClick={() => setDialog("manage")}>
            {copy.timelineManageItems}
          </button>
          {/* 第四颗是 AI 一键分类：按钮与预览层都在 `ItemsAiTagButton` 里（只列未打标事项、
              取消零写入、落库报条数 + 一次整体撤销）。写完重拉本区清单。 */}
          <ItemsAiTagButton items={items} onApplied={reload} onToast={onToast} />
        </div>
      </div>

      {state === "loading" ? (
        <div className="at-skeleton" data-row="todo" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
        </div>
      ) : state === "error" ? (
        <div className="at-module-error" role="alert" data-error-layer="module">
          <p className="at-module-error-text">{UI_TEXT.common.readFailed}</p>
          <button type="button" className="at-link-btn" onClick={reload}>
            {UI_TEXT.common.retry}
          </button>
        </div>
      ) : state === "empty" ? (
        <p className="at-empty">{copy.itemsEmpty}</p>
      ) : (
        <div className="at-items-groups at-scroll-region at-scroll-region-stable">
          {pinned.length > 0 ? (
            <section className="at-items-group" data-group="pinned">
              <h4 className="at-items-group-title">{copy.itemsPinnedGroup}</h4>
              <ul className="at-items-list">{pinned.map(renderRow)}</ul>
            </section>
          ) : null}
          {recent.length > 0 ? (
            <section className="at-items-group" data-group="recent">
              <h4 className="at-items-group-title">{copy.itemsRecentGroup}</h4>
              <ul className="at-items-list">{recent.map(renderRow)}</ul>
            </section>
          ) : null}
        </div>
      )}

      {/* 弹层是本区根节点的**兄弟**：挂在四态分支里，空态/错误态下点「新增」就什么都
          不会出来（`TimelineCardEntry.test.tsx` 钉的就是这一条）。 */}
      <TimelineManage
        mode={dialog === "edit" ? null : dialog}
        onClose={() => setDialog(null)}
        onLocalRename={onLocalRename}
        onLocalCreate={onLocalCreate}
      />
      <TimelineEditDialog
        open={dialog === "edit"}
        onClose={() => setDialog(null)}
        todayItemIds={editableItemIds}
        onLocalRename={onLocalRename}
      />
    </div>
  );
}
