/**
 * 「今日时间线」卡的两个写面：**新建事项** 与 **事项管理**（[本轮] 按主人口径重做）。
 *
 * 主人口径（原话）：「事项管理应参考悬浮窗部分事项菜单内的功能，支持时间等……
 * 常用事项应在新建时可添加，如快捷添加一致……建议直接在该处调用原功能」。
 * 落地成两颗卡底入口：
 *   1. **＋ 新建事项**：名称 + 默认时长（可空 = 正计时）+ 分类 +「设为常用」勾选
 *      （**默认不勾**，勾选才进常用组）。[0.13] 表单整块交给 `TimelineCreateDialog`。
 *   2. **事项管理**：常用事项（上移/下移/取消常用/编辑/改分类）+ 近期事项
 *      （设为常用/编辑/改分类），行内就地展开「名称 + 默认时长」。
 *      **不再**把全表摊开、**没有**单独的改名按钮列。
 *
 * ## 为什么这里一条写命令都没有
 *
 * 分析窗的权限面里**没有**写命令（`permissions/patina-host-bridge.toml` 只放行三条只读），
 * 所以每个动作都只是 `patina:host-intent` 的一条意图，由药丸用 `itemApi` / `settingsApi` 落库。
 * 意图**没有回执**：这里既拿不到新 id，也拿不到失败文案（失败弹在药丸上，§6.5）。
 * 于是两种本地收敛：
 *   · `emitHostIntent` 返回 `false` → **一步都不许推进本地状态**，弹层留着让用户重试
 *     （照 `NotesStrip` 删除便利贴的先例）；
 *   · 返回 `true` → 本地乐观更新 + 待确认集（`useItemPrefs` 里那两张 pending 表）。
 *
 * ## 明确不做（别在下一次需求里"顺手"加回来）
 *
 * 删除事项（牵连 `time_records` 的历史归属）、HTML5 拖拽排序（主界面卡片本身已有拖拽，
 * 会抢事件 → 只用 ↑/↓ 按钮）、改色、提醒时刻 —— 各自是独立改造。
 */
import { useCallback, useMemo, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { emitHostIntent, type HostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import DataCategoryManageDialog from "../../data/components/DataCategoryManageDialog.tsx";
import { DASHBOARD_COPY } from "../copy.ts";
import { useItemCategoryOptions } from "../hooks/useItemCategoryOptions.ts";
import { useItemPrefs } from "../hooks/useItemPrefs.ts";
import { nextSortOrder, pinnedItems, recentItems } from "../services/itemPrefs.ts";
import TimelineCreateDialog from "./TimelineCreateDialog.tsx";
import TimelineItemRows, { type ItemPatchIntent } from "./TimelineItemRows.tsx";

export type TimelineManageMode = "create" | "manage" | null;

interface Props {
  mode: TimelineManageMode;
  onClose: () => void;
  /** 交给 `useTodayItems.applyLocalRename`：本地先改，别让下一次刷新覆盖回去 */
  onLocalRename: (itemId: number, name: string) => void;
  /** 交给 `useTodayItems.applyLocalCreate`：重拉一次（新条目要有真实 id 才会出现在下一轮） */
  onLocalCreate: (name: string) => void;
}

export default function TimelineManage({ mode, onClose, onLocalRename, onLocalCreate }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const { items, timers, recentCount, showRecent, status, applyLocalItem, applyLocalTimer } =
    useItemPrefs(mode !== null);
  /* 分类候选只在「事项管理」打开时取：两个弹层互斥，各自一条 `active` 就不会重复打 IPC */
  const { options: categoryOptions, reload: reloadCategories } = useItemCategoryOptions(mode === "manage");

  const [manageIssue, setManageIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);

  const pinned = useMemo(() => pinnedItems(items), [items]);
  const recent = useMemo(
    () => (showRecent ? recentItems(items, recentCount) : []),
    [items, showRecent, recentCount],
  );

  /** 发一条意图；返回「有没有发出去」。发失败留弹层 + 一句提示，本地一个字都不改。 */
  const sendIntent = useCallback(async (intent: HostIntent): Promise<boolean> => {
    setBusy(true);
    const sent = await emitHostIntent(intent);
    setBusy(false);
    if (!sent) {
      setManageIssue(copy.timelineSaveFailed);
      return false;
    }
    setManageIssue(null);
    return true;
  }, [copy.timelineSaveFailed]);

  /**
   * 行上的写动作（改名 / 时长 / 设或取消常用 / 改分类）。
   * 「设为常用」时顺手补 `max+1` 的落点。
   */
  const handleUpdate = useCallback(async (id: number, patch: ItemPatchIntent): Promise<boolean> => {
    const resolved: ItemPatchIntent = { ...patch };
    if (resolved.isPinned === true && resolved.sortOrder === undefined) {
      resolved.sortOrder = nextSortOrder(pinned);
    }
    const intent: HostIntent = { action: "update_item", id, ...resolved };
    const sent = await sendIntent(intent);
    if (!sent) return false;
    if (resolved.name !== undefined) {
      applyLocalItem(id, { name: resolved.name });
      onLocalRename(id, resolved.name);
    }
    if (resolved.isPinned !== undefined || resolved.sortOrder !== undefined) {
      applyLocalItem(id, { isPinned: resolved.isPinned, sortOrder: resolved.sortOrder });
    }
    if (resolved.categoryKey !== undefined) {
      applyLocalItem(id, { categoryKey: resolved.categoryKey });
    }
    if (resolved.timerMinutes !== undefined) {
      applyLocalTimer(id, resolved.timerMinutes);
    }
    return true;
  }, [applyLocalItem, applyLocalTimer, onLocalRename, pinned, sendIntent]);

  /**
   * 上移 / 下移：**只交换这两条的 `sortOrder`**（整组重排要发 N 条意图，没必要）。
   * 老数据里可能有重复的 `sortOrder`（全是 0），交换等于没动 → 这时退回用**位置**当值，
   * 至少保证方向是对的（否则用户会以为按钮坏了）。
   */
  const handleMove = useCallback(async (from: number, to: number): Promise<boolean> => {
    const moving = pinned[from];
    const other = pinned[to];
    if (!moving || !other || from === to) return false;
    const distinct = moving.sortOrder !== other.sortOrder;
    const movingOrder = distinct ? other.sortOrder : to;
    const otherOrder = distinct ? moving.sortOrder : from;
    if (!(await sendIntent({ action: "update_item", id: moving.id, sortOrder: movingOrder }))) {
      return false;
    }
    applyLocalItem(moving.id, { sortOrder: movingOrder });
    if (!(await sendIntent({ action: "update_item", id: other.id, sortOrder: otherOrder }))) {
      return false;
    }
    applyLocalItem(other.id, { sortOrder: otherOrder });
    return true;
  }, [applyLocalItem, pinned, sendIntent]);

  return (
    <>
      <TimelineCreateDialog
        open={mode === "create"}
        copy={copy}
        pinned={pinned}
        onClose={onClose}
        onLocalCreate={onLocalCreate}
      />

      <QuietDialog
        open={mode === "manage"}
        title={copy.timelineManageItems}
        surfaceClassName="at-timeline-manage-dialog"
        onClose={onClose}
        actions={(
          <button
            type="button"
            className="at-button at-button-compact at-button-secondary"
            onClick={onClose}
          >
            {UI_TEXT.common.close}
          </button>
        )}
      >
        <TimelineItemRows
          pinned={pinned}
          recent={recent}
          timers={timers}
          status={status}
          busy={busy}
          issue={manageIssue}
          showRecent={showRecent}
          copy={copy}
          categoryOptions={categoryOptions}
          onUpdate={handleUpdate}
          onMove={handleMove}
          onManageCategories={() => setManageCategoriesOpen(true)}
        />
      </QuietDialog>

      {/* 分类管理挂在「事项管理」**之外**：两者都 portal 到 body，套进去只会让 Escape 与
          焦点陷阱各关一层。增删改之后重取候选 —— 否则刚建的分类在下拉里还选不到。 */}
      <DataCategoryManageDialog
        open={manageCategoriesOpen}
        onClose={() => setManageCategoriesOpen(false)}
        onChanged={reloadCategories}
      />
    </>
  );
}
