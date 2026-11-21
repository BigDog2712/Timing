/**
 * 今日时间线卡 · **下区 = 今天的计时记录**（0.13.x 恢复入口）。
 *
 * 自上而下：进行中 / 已暂停 / 已完成（可展开第二层的应用段/空档，
 * `TimelineChildRows`）。
 *
 * [本轮] 主人口径：**「常用事项」组整组下线** —— 这张卡只回答“今天做了什么”，
 * “还能做什么”（常用事项一键起停）归「事项管理」卡。同一批事项在两张卡上都出现，
 * 用户分不清“该在哪张卡上找它”。
 *
 * [2026-11-20] 行右侧那颗悬停才浮出的「改起止」已删除：改起止并入「编辑事项」弹层
 * （`ItemRecordTimeSection`），只改时刻、日期不再出现在界面上。行回到三列
 * （名称 - 起止 - 总用时），不再有 hover 才长出来的第四颗按钮。
 *
 * [2026-11-20] 主人口径：**「历史事项」组整组下线** —— 这张卡回答的是"今天做了什么、
 * 还能做什么"，近期但今天没碰过的事项属于「事项管理」卡（`ItemsManageZone` 仍有那一组）。
 * 同一批事项在两张卡上都出现，用户分不清"该在哪张卡上找它"。卡的位置也从下区搬到上区
 * （见 `TimelineTodosCard` 的线框）。
 *
 * ## 入口回到本区（0.12.6 的反向决定）
 *
 * 0.12.6 把「新建 / 编辑 / 事项管理」整组搬进了独立的「事项管理」卡，本区只剩"看与改"。
 * 主人口径（2026-11-20）要求**恢复「新建事项」「编辑事项」**：用户在一张卡上就看到
 * "今天做了什么 + 还能做什么"，不必先知道另一张卡的存在。所以：
 *   · 两颗入口挂在本区标题行（`.`at-items-zone-actions`，四态之外常驻 —— 空态恰恰是最想
 *     新建的时刻，判据 `TimelineCardEntry.test.tsx`）；
 *   · 「事项管理」**不回来**：它仍住在 `ManageCard`（常用/历史的完整管理、排序、AI 分类），
 *     同一个动作在两张卡上各有一颗按钮，用户对"按钮在哪"会永久失败。
 *
 * ## 正在计时的那一条（`useTodayItems` 的合并帧）
 *
 * `list_records` 只回 `status='saved'`，正在计的会话**永远不在**记录里。`useTodayItems`
 * 把宿主 `timer:state-changed` 并进今日行（`mergeActiveSession`），本区因此能看到它：
 *   · `lastEnd === null` → 「止」列显示此刻钟点 + 进行中（`timelineNoEnd`）；
 *   · `paused` → 「止」列写「已暂停」：数字不再涨，写"进行中"会让用户误以为还在跳。
 *
 * ## 第二层是**附加信息**
 *
 * `useItemTimeline()` 拿不到子记录时只有第一层，不把卡片打成错误态（见该 hook 头注释）。
 */
import { useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import { useItemTimeline } from "../hooks/useItemTimeline.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import { useBoardInstance, withInstance } from "../layout/instanceContext.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import {
  buildTimelineRows,
  todayTimedItemIds,
  type TimelineRow,
} from "../services/timelineRows.ts";
import { moduleState, type ModuleState } from "./ModuleShell.tsx";
import TimelineChildRows from "./TimelineChildRows.tsx";
import TimelineEditDialog from "./TimelineEditDialog.tsx";
import TimelineManage from "./TimelineManage.tsx";

/** 本区两个弹层的互斥态（「事项管理」不在这里，它住 `ManageCard`） */
type TimelineDialog = "create" | "edit" | null;

const noopRename = (): void => undefined;
const noopCreate = (): void => undefined;

interface Props {
  /** 今日事项行（`useTodayItems.rows`，由 `Dashboard` 提起后传进来；本组件不取数） */
  items: readonly TodayItemRow[];
  /** 今日总计（`useTodayItems.total`，后端口径；不许在这里用 `(end-start)` 另算） */
  total: number;
  /** 事项源的读取状态：只有 `ready` 才把总计当数（loading 的数还没有、error 的数不可信） */
  status: LoadStatus;
  /** 重试事项源 */
  onRetry: () => void;
  /** 交给 `useTodayItems.applyLocalRename`（改名意图发出后本地先改） */
  onLocalRename?: (itemId: number, name: string) => void;
  /** 交给 `useTodayItems.applyLocalCreate`（新条目重拉一次，拿到真实 id） */
  onLocalCreate?: (name: string) => void;
}

export default function TimelineZone({
  items,
  total,
  status,
  onRetry,
  onLocalRename = noopRename,
  onLocalCreate = noopCreate,
}: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const domId = withInstance("t-items-timeline", useBoardInstance());
  const [dialog, setDialog] = useState<TimelineDialog>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());

  const { byItemId } = useItemTimeline();

  /* 全量渲染：`limit = items.length` 恒等于"不裁" —— 比一个魔法大数更能自解释 */
  const rows = buildTimelineRows(items, items.length);
  const runningRows = rows.filter((row) => row.running);
  const finishedRows = rows.filter((row) => !row.running);

  /* [本轮] 「常用事项」组已下线：hasData 只看今日行。 */
  const hasData = rows.length > 0;

  /* 有数据 + error = 刷新失败（E3，卡头小图标由待办区统一画）；无数据 + error = 模块级错误 */
  const state: ModuleState = moduleState(status, status === "error" && hasData, !hasData);
  const totalReady = status === "ready";

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderRow = (row: TimelineRow, group: "running" | "finished") => {
    const detail = byItemId.get(Number(row.key));
    const isOpen = expanded.has(row.key);
    /* 暂停中的行既不写"进行中"（数字不涨）也不写此刻钟点（会让人以为还在走） */
    const rangeText = row.running
      ? row.paused
        ? copy.timelinePaused
        : copy.timelineNoEnd(row.endLabel)
      : copy.timelineRange(row.startLabel, row.endLabel);
    return (
      <li
        key={row.key}
        className="at-timeline-row"
        data-group={group}
        data-running={row.running || undefined}
        data-paused={row.paused || undefined}
      >
        <span className="at-timeline-label" title={row.label}>
          {detail && detail.segments.length + detail.gaps.length > 0 ? (
            <button
              type="button"
              className="at-timeline-toggle"
              aria-expanded={isOpen}
              title={isOpen
                ? copy.timelineChildrenCollapse
                : copy.timelineChildrenToggle(detail.segments.length + detail.gaps.length)}
              onClick={() => toggleExpanded(row.key)}
            >
              {isOpen ? "▾" : "▸"}
            </button>
          ) : null}
          {row.label}
        </span>
        <span className="at-timeline-range" title={rangeText}>{rangeText}</span>
        <span className="at-timeline-duration">{row.duration}</span>
        {isOpen && detail ? <TimelineChildRows row={detail} /> : null}
      </li>
    );
  };

  return (
    <div
      className="at-items-zone at-items-zone-timeline"
      data-zone="timeline"
      data-state={state}
      aria-labelledby={domId}
    >
      {/* ── 区标题行：标题 + 总计 + 两颗入口。入口在四态之外常驻（读失败也要能新建） ── */}
      <div className="at-items-zone-head">
        <h3 className="at-items-zone-title" id={domId}>{copy.itemsTitle}</h3>
        {totalReady ? <span className="at-card-meta">{copy.timelineTotal(formatDashboardDuration(total))}</span> : null}
        <div className="at-items-zone-actions">
          <button type="button" className="at-link-btn" onClick={() => setDialog("create")}>
            {copy.timelineNewItem}
          </button>
          <button type="button" className="at-link-btn" onClick={() => setDialog("edit")}>
            {copy.timelineEditItem}
          </button>
        </div>
      </div>

      {state === "loading" ? (
        <div className="at-skeleton" data-row="todo" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
        </div>
      ) : state === "error" ? (
        <div className="at-module-error" role="alert" data-error-layer="module">
          <p className="at-module-error-text">{UI_TEXT.common.readFailed}</p>
          <button type="button" className="at-link-btn" onClick={onRetry}>
            {UI_TEXT.common.retry}
          </button>
        </div>
      ) : state === "empty" ? (
        <p className="at-empty">{copy.itemsTimelineEmpty}</p>
      ) : (
        <div className="at-timeline-scroll">
          <ul className="at-timeline-rows">
            {runningRows.map((row) => renderRow(row, "running"))}
            {finishedRows.map((row) => renderRow(row, "finished"))}
          </ul>
        </div>
      )}

      {/* 弹层是本区根节点的**兄弟**：挂进四态分支，空态/错误态下点了就没反应 */}
      <TimelineManage
        mode={dialog === "create" ? "create" : null}
        onClose={() => setDialog(null)}
        onLocalRename={onLocalRename}
        onLocalCreate={onLocalCreate}
      />
      <TimelineEditDialog
        open={dialog === "edit"}
        onClose={() => setDialog(null)}
        todayItemIds={todayTimedItemIds(items)}
        onLocalRename={onLocalRename}
      />
    </div>
  );
}