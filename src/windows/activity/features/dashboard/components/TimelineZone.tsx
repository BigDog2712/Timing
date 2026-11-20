/**
 * 今日时间线卡 · **下区 = 今天的计时记录**（0.12.6）。
 *
 * 自上而下：进行中（止列显示此刻钟点）→ 已完成（可展开第二层的应用段/空档，
 * `TimelineChildRows`）→ 每行右侧的「改起止」（`TimelineRecordTimeDialog`）。
 *
 * ## 这一区只剩"看与改"，不再造事项
 *
 * 0.12.5 的时间线卡底部有三颗入口（新建 / 编辑 / 事项管理），0.12.6 起这三颗**整组搬进了
 * 事项管理卡**（`ManageCard` → `ItemsManageZone`）—— 同一个动作在两张卡上各有一颗按钮，
 * 点错了只是打开同一个弹层，但用户的"这个按钮在哪张卡上"会永久地失败。上区待办自带
 * 「新建待办」，本区就只负责记录。
 *
 * ## 行数不写死：按实际行数全渲染
 *
 * 旧时间线卡按档位（S/M/L = 4/6/8 行）切片。现在本区只占卡的下半块（上区还有待办），
 * 切片会让"今天真做过的事"看不见 —— 所以全渲染，溢出靠 `.at-timeline-rows` 自己滚。
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
import { buildTimelineRows, type TimelineRow } from "../services/timelineRows.ts";
import { moduleState, type ModuleState } from "./ModuleShell.tsx";
import TimelineChildRows from "./TimelineChildRows.tsx";
import TimelineRecordTimeDialog from "./TimelineRecordTimeDialog.tsx";

interface Props {
  /** 今日事项行（`useTodayItems.rows`，由 `Dashboard` 提起后传进来；本组件不取数） */
  items: readonly TodayItemRow[];
  /** 今日总计（`useTodayItems.total`，后端口径；不许在这里用 `(end-start)` 另算） */
  total: number;
  /** 事项源的读取状态：只有 `ready` 才把总计当数（loading 的数还没有、error 的数不可信） */
  status: LoadStatus;
  /** 重试事项源 */
  onRetry: () => void;
}

export default function TimelineZone({ items, total, status, onRetry }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const domId = withInstance("t-items-timeline", useBoardInstance());
  /** 「改起止」弹层：`null` = 关着；数字 = 该事项的 itemId（弹层自己按需拉段） */
  const [recordEditItemId, setRecordEditItemId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());

  const { byItemId } = useItemTimeline();

  /* 全量渲染：`limit = items.length` 恒等于"不裁" —— 比一个魔法大数更能自解释 */
  const rows = buildTimelineRows(items, items.length);
  const runningRows = rows.filter((row) => row.running);
  const finishedRows = rows.filter((row) => !row.running);

  /* 有行 + error = 刷新失败（E3，卡头小图标由待办区统一画）；无行 + error = 模块级错误 */
  const state: ModuleState = moduleState(status, status === "error" && rows.length > 0, rows.length === 0);
  const totalReady = status === "ready";

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const recordEditItemName = items.find((item) => item.itemId === recordEditItemId)?.name ?? "";

  const renderRow = (row: TimelineRow, group: "running" | "finished") => {
    const detail = byItemId.get(Number(row.key));
    const isOpen = expanded.has(row.key);
    return (
      <li key={row.key} className="at-timeline-row" data-group={group} data-running={row.running || undefined}>
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
        <span
          className="at-timeline-range"
          title={row.running ? copy.timelineNoEnd(row.endLabel) : copy.timelineRange(row.startLabel, row.endLabel)}
        >
          {row.running ? copy.timelineNoEnd(row.endLabel) : copy.timelineRange(row.startLabel, row.endLabel)}
        </span>
        <span className="at-timeline-duration">{row.duration}</span>
        <button
          type="button"
          className="at-link-btn at-timeline-record-edit"
          aria-label={`${copy.editRecordTime} ${row.label}`}
          onClick={() => setRecordEditItemId(Number(row.key))}
        >
          {copy.editRecordTime}
        </button>
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
      {/* ── 区标题行：标题 + 总计。总计只在事项源 ready 时给数 ── */}
      <div className="at-items-zone-head">
        <h3 className="at-items-zone-title" id={domId}>{copy.itemsTitle}</h3>
        {totalReady ? <span className="at-card-meta">{copy.timelineTotal(formatDashboardDuration(total))}</span> : null}
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
        <ul className="at-timeline-rows at-scroll-region at-scroll-region-stable">
          {runningRows.map((row) => renderRow(row, "running"))}
          {finishedRows.map((row) => renderRow(row, "finished"))}
        </ul>
      )}

      {/* 弹层是本区根节点的**兄弟**（见文件头第 4 段）：挂进条件分支就会"点得到没反应" */}
      <TimelineRecordTimeDialog
        itemId={recordEditItemId}
        itemName={recordEditItemName}
        onClose={() => setRecordEditItemId(null)}
      />
    </div>
  );
}
