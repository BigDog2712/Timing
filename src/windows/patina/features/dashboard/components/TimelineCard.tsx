/**
 * [0.13 · 1.6 重做] 今日时间线卡：一行 = 「事项名称 - 起止时间 - 总用时」。
 *
 * 主人口径：卡头右侧是**总计**（口径来自 `useTodayItems.total` —— 即后端
 * `accumulated_sec` 之和，前端不许用 `(end-start)` 自己另算一遍）；
 * 卡头**不再有**「事项菜单 / 常用」两颗唤起药丸的按钮（已删，入口收敛到卡底）。
 *
 * 卡底三颗入口（footer，empty 态也在场）：
 *   1. **＋ 新建事项**：名称 + 默认时长 + 设为常用（`TimelineManage` 的 create 弹层）；
 *   2. **编辑事项**：先选事项 → 改名称 + 默认时长（`TimelineEditDialog`，一条 update_item）；
 *   3. **事项管理**：常用 / 近期两组，行内编辑（`TimelineManage` 的 manage 弹层）。
 *
 * ## 三个弹层是 `ModuleShell` 的兄弟，不是 children（别改回去）
 *
 * 入口在 `footer` 上（四态常驻），弹层最初却写在 children 里 —— 而 children **只在
 * ready 态渲染**。于是「今天还没有计时」这一天点三颗键一点反应都没有：`setDialog`
 * 执行了，消费它的组件没挂载，零报错零提示（`TimelineCardEntry.test.tsx` 就是为这条
 * 留的）。待办卡的 `TodoComposeDialog` 早就是兄弟关系，同一口径。
 *
 * 行上还有第四个动作 **改起止**（T03b）：打开 `TimelineRecordTimeDialog`，
 * 走 `update_record_time` 意图 —— 这是本轮唯一改写历史数据语义的入口。
 *
 * 三条克制（沿用）：时间线行只读展示（除「改起止」）；一行一个事项；顺序按第一段
 * 开始时刻升序。写动作一律 `patina:host-intent`，分析窗没有写命令。
 */
import { useState } from "react";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import { formatDashboardDuration } from "../services/dashboardFormatting.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { CardTier } from "../layout/contract.ts";
import ModuleShell, { moduleState } from "./ModuleShell.tsx";
import TimelineChildRows from "./TimelineChildRows.tsx";
import { useItemTimeline } from "../hooks/useItemTimeline.ts";
import TimelineManage from "./TimelineManage.tsx";
import TimelineEditDialog from "./TimelineEditDialog.tsx";
import TimelineRecordTimeDialog from "./TimelineRecordTimeDialog.tsx";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import type { ReactNode } from "react";

const ROWS_BY_TIER: Record<CardTier, number> = { S: 4, M: 6, L: 8 };

/** 卡底三个弹层的互斥态（`TimelineManage` 自己的 mode 只认 create / manage）。 */
type TimelineDialogMode = "create" | "edit" | "manage" | null;

export interface TimelineRow {
  key: string;
  /** 事项名 */
  label: string;
  /** 第一段的开始钟点（`09:00`） */
  startLabel: string;
  /** 最后一段的结束钟点；进行中 = 此刻钟点（`buildTimelineRows` 用 `nowMs` 折算） */
  endLabel: string;
  /** `lastEnd === null`（还有一段在跑）——行上用 `timelineNoEnd` 标注 */
  running: boolean;
  /** 事项名下那行的总用时（已格式化） */
  duration: string;
  value: number;
}

function clockOf(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * 时间线上「算一回事」的判据：真的计过时（`value > 0`）、有可用的第一段开始时刻、
 * 名字非空。`buildTimelineRows`（画几行）与 `todayTimedItemIds`（能编辑哪些）
 * **共用这一份** —— 两处各写一遍条件，某天只改了一处，就会变成
 * 「卡上看得见、编辑弹层里找不到」。
 */
function isTimelineItem(item: TodayItemRow): boolean {
  return item.value > 0 && Number.isFinite(item.firstStart) && item.name.trim().length > 0;
}

/** 纯函数：事项行 → 时序行（导出是为了能单测，渲染层不该是判据唯一证人）。 */
export function buildTimelineRows(
  items: readonly TodayItemRow[],
  limit: number,
  nowMs: number = Date.now(),
): TimelineRow[] {
  return items
    .filter(isTimelineItem)
    .slice()
    .sort((a, b) => a.firstStart - b.firstStart)
    .slice(0, limit)
    .map((item) => ({
      key: `${item.itemId}`,
      label: item.name,
      startLabel: clockOf(item.firstStart),
      /* 「止」= 今天最后一段的结束；进行中显示**此刻**（V-1.6b），不是空白 */
      endLabel: clockOf(item.lastEnd ?? nowMs),
      running: item.lastEnd === null,
      duration: formatDashboardDuration(item.value),
      value: item.value,
    }));
}

/**
 * 「编辑事项」的候选 = **今日时间线上的事项**（按第一段开始时刻升序），
 * **不受档位行数限制**。
 *
 * 主人口径（2026-11-14）：「编辑事项指对今日时间线上的事项进行编辑」。
 * 上一版候选取的是**全部** `items`（按 `updatedAt` 倒序），于是那个列表里混着
 * 半年前建的「测试」「测试2」「阿萨德」—— 用户要改的是今天做过的那几件，
 * 不是库里建过的一切。卡上只画得下 4~8 行，但第 9 件今天也计时过，它同样该能编辑，
 * 所以这里按"今天计过时"筛，而不是按"卡上画出来的行"筛。
 */
export function todayTimedItemIds(items: readonly TodayItemRow[]): number[] {
  return items
    .filter(isTimelineItem)
    .slice()
    .sort((a, b) => a.firstStart - b.firstStart)
    .map((item) => item.itemId);
}

interface Props {
  controls?: ReactNode;
  items: readonly TodayItemRow[];
  /** 今日总计（来自 `useTodayItems.total`，后端口径；不许在卡里重算） */
  total: number;
  tier: CardTier;
  status: LoadStatus;
  refreshError: boolean;
  onRetry: () => void;
  /** [本轮] 改名已发出后通知时间线本地先改（`useTodayItems.applyLocalRename`） */
  onLocalRename: (itemId: number, name: string) => void;
  /** [本轮] 新建已发出后通知时间线重拉一次（`useTodayItems.applyLocalCreate`） */
  onLocalCreate: (name: string) => void;
}

export default function TimelineCard({
  controls,
  items,
  total,
  tier,
  status,
  refreshError,
  onRetry,
  onLocalRename,
  onLocalCreate,
}: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const rows = buildTimelineRows(items, ROWS_BY_TIER[tier]);
  const state = moduleState(status, refreshError, rows.length === 0);
  /** 三个弹层互斥（同一时刻只可能有一个）：`null` = 都关着。 */
  const [dialog, setDialog] = useState<TimelineDialogMode>(null);
  /** 「改起止」弹层：`null` = 关着；数字 = 该事项的 itemId（弹层自己按需拉段） */
  const [recordEditItemId, setRecordEditItemId] = useState<number | null>(null);
  /* 第二层数据（事项 → 子记录 + 空档）。它是**附加信息**：拿不到就只有第一层，
     不把卡片打成错误态（见 `useItemTimeline` 头注释）。 */
  const { byItemId } = useItemTimeline();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const recordEditItemName = items.find((item) => item.itemId === recordEditItemId)?.name ?? "";
  /* 「编辑事项」的候选 = 今日计时过的事项（不受档位行数限制，理由见 `todayTimedItemIds`） */
  const editableItemIds = todayTimedItemIds(items);

  return (
    <>
      <ModuleShell
        controls={controls}
        id="t-timeline"
        title={copy.cardLabels.timeline}
        className="qp-card-timeline"
        state={state}
        skeletonRows={4}
        skeletonRow="todo"
        errorText={UI_TEXT.common.readFailed}
        retryLabel={UI_TEXT.common.retry}
        onRetry={onRetry}
        refreshErrorText={refreshError ? UI_TEXT.common.refreshFailed : undefined}
        emptyText={copy.timerEmpty}
        /* 卡头读数 = 总计（`useTodayItems.total`，后端口径）。右槽在 ready 才渲染
           （ModuleShell 的 R9 收口），空态/错误态不给假数字。 */
        meta={copy.timelineTotal(formatDashboardDuration(total))}
        /* [本轮] 卡底三个写入口放 **footer** 而不是 children：children 只在 ready 渲染，
           而「今天还没有计时」正是最想新建/管理事项的时刻（`ModuleShell` 的 footer 注释）。 */
        footer={(
          <div className="qp-timeline-manage">
            <button type="button" className="qp-link-btn" onClick={() => setDialog("create")}>
              {copy.timelineNewItem}
            </button>
            <button type="button" className="qp-link-btn" onClick={() => setDialog("edit")}>
              {copy.timelineEditItem}
            </button>
            <button type="button" className="qp-link-btn" onClick={() => setDialog("manage")}>
              {copy.timelineManageItems}
            </button>
          </div>
        )}
      >
        <ul className="qp-timeline-rows">
          {rows.map((row) => {
            const detail = byItemId.get(Number(row.key));
            const isOpen = expanded.has(row.key);
            return (
              <li key={row.key} className="qp-timeline-row" data-running={row.running || undefined}>
                <span className="qp-timeline-label" title={row.label}>
                  {detail && detail.segments.length + detail.gaps.length > 0 ? (
                    <button
                      type="button"
                      className="qp-timeline-toggle"
                      aria-expanded={isOpen}
                      title={isOpen ? copy.timelineChildrenCollapse : copy.timelineChildrenToggle(detail.segments.length + detail.gaps.length)}
                      onClick={() => toggle(row.key)}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  ) : null}
                  {row.label}
                </span>
                <span
                  className="qp-timeline-range"
                  title={row.running ? copy.timelineNoEnd(row.endLabel) : copy.timelineRange(row.startLabel, row.endLabel)}
                >
                  {row.running
                    ? copy.timelineNoEnd(row.endLabel)
                    : copy.timelineRange(row.startLabel, row.endLabel)}
                </span>
                <span className="qp-timeline-duration">{row.duration}</span>
                <button
                  type="button"
                  className="qp-link-btn qp-timeline-record-edit"
                  aria-label={`${copy.editRecordTime} ${row.label}`}
                  onClick={() => setRecordEditItemId(Number(row.key))}
                >
                  {copy.editRecordTime}
                </button>
                {isOpen && detail ? <TimelineChildRows row={detail} /> : null}
              </li>
            );
          })}
        </ul>
      </ModuleShell>

      {/* 三个弹层是 `ModuleShell` 的**兄弟**，不是 children（照待办卡的 `TodoComposeDialog`）：
          卡底三颗入口挂在 footer 上、empty / error 态都在场，而 children 只在 ready 态渲染 ——
          弹层留在 children 里就会出现「今天还没有计时 → 点新建事项一点反应都没有」：
          点得到、`setDialog` 也执行了，但没有人消费那个状态，零报错零提示。
          （0.13 · 1.6 就是这么写进去的，空态下三颗键全哑。）
          三个弹层都 portal 到 body，放在卡外不影响这张卡的排版。 */}
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
      <TimelineRecordTimeDialog
        itemId={recordEditItemId}
        itemName={recordEditItemName}
        onClose={() => setRecordEditItemId(null)}
      />
    </>
  );
}
