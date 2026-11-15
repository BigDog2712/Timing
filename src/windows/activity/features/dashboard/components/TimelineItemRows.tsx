/**
 * 「事项管理」弹层的**两组列表 + 行控件**（[本轮]，从 `TimelineManage` 拆出来）。
 *
 * 拆出来的理由与 `timelineItemName.ts` 一样：`TimelineManage.tsx` 是容器（两个对话框、
 * 发意图、乐观更新），行控件是另一个关注点，塞在一个文件里两边都读不下去，还会撞上
 * 单文件 300 行的棘轮。这里**不发意图、不碰本地数据**：一切写动作都通过 `onUpdate` /
 * `onMove` 交回容器 —— 因为“发出去没有”只有容器知道（事件桥没有回执）。
 *
 * [0.13 · 1.6] 行内编辑态抽成了 `ItemEditForm`（与卡底「编辑事项」弹层共用同一张表单，
 * 校验口径只写一遍）；本文件只剩列表结构、行读数与 ↑/↓/常用 按钮。
 *
 * 三条实现口径（都是踩过的坑）：
 *   1. **不用 HTML5 拖拽**：主界面卡片本身已有拖拽排序，行上再挂 `draggable` 会抢事件
 *      （拖卡片变成拖事项）。所以排序只有 ↑/↓ 两颗真按钮，且**只在常用组内**可用。
 *   2. 行内编辑用**真表单**（名称 + 默认时长）、Enter 保存、Escape 取消（在 `ItemEditForm` 里）。
 *   3. `aria-label` 写成「动作 事项名」（`上移 开会`，**空格不用冒号**）：一行里有四颗按钮，
 *      只念“上移”读屏用户分不清是哪一条；而全角冒号在 en/ru/es 里混排成 `Move up：Code`，
 *      所以分隔符用与语言无关的空格。
 */
import { useState } from "react";

import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import type { TimelineManageCopy } from "../copyTimeline.ts";
import {
  clampItemMinutes,
  itemTimerMinutes,
  type ItemPrefsLike,
  type ItemTimers,
} from "../services/itemPrefs.ts";
import {
  checkItemName,
  ITEM_NAME_MAX_LEN,
  type ItemNameIssue,
} from "../services/timelineItemName.ts";
import ItemEditForm from "./ItemEditForm.tsx";
import ItemCategoryField from "./ItemCategoryField.tsx";
import type { ItemCategoryOption } from "../hooks/useItemCategoryOptions.ts";

/**
 * 一次写意图的载荷（容器按它拼 `update_item`）。
 * `timerMinutes` 三态见 `withItemTimer`；`categoryKey` 同型三态
 * （缺省不改 / `null` 回到未分类 / 字符串设为该分类）。
 */
export interface ItemPatchIntent {
  name?: string;
  isPinned?: boolean;
  sortOrder?: number;
  timerMinutes?: number | null;
  categoryKey?: string | null;
}

interface Props {
  pinned: readonly ItemPrefsLike[];
  recent: readonly ItemPrefsLike[];
  timers: ItemTimers;
  status: LoadStatus;
  busy: boolean;
  /** 容器给的失败文案（意图没发出去）；`null` = 没出错 */
  issue: string | null;
  showRecent: boolean;
  copy: TimelineManageCopy;
  /** 事项分类候选（「未分类」由 `ItemCategoryField` 自己补，不在这个数组里） */
  categoryOptions: readonly ItemCategoryOption[];
  onUpdate: (itemId: number, patch: ItemPatchIntent) => Promise<boolean>;
  onMove: (from: number, to: number) => Promise<boolean>;
  /** 打开分类管理（增删改分类）—— 全弹层只一颗，行内不重复 */
  onManageCategories: () => void;
}

export default function TimelineItemRows({
  pinned,
  recent,
  timers,
  status,
  busy,
  issue,
  showRecent,
  copy,
  categoryOptions,
  onUpdate,
  onMove,
  onManageCategories,
}: Props) {
  const UI_TEXT = useLocaleText();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftMinutes, setDraftMinutes] = useState("");
  const [rowIssue, setRowIssue] = useState<string | null>(null);

  /* 两种校验结果，穷尽（`ItemNameIssue` 已收窄）；「意图没发出去」由容器的 `!sent`
     分支直接赋文案，不经过这里。 */
  const describeNameIssue = (code: ItemNameIssue): string =>
    code === "empty" ? copy.timelineNameEmpty : copy.timelineNameTooLong(ITEM_NAME_MAX_LEN);

  const startEdit = (item: ItemPrefsLike) => {
    setEditingId(item.id);
    setDraftName(item.name);
    const minutes = itemTimerMinutes(timers, item.id);
    setDraftMinutes(minutes === null ? "" : String(minutes));
    setRowIssue(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
    setDraftMinutes("");
    setRowIssue(null);
  };

  /** 保存：只提交**真的变了**的字段（没变就安静关掉，别多发一条意图）。 */
  const saveEdit = (item: ItemPrefsLike) => {
    const name = draftName.trim();
    const nameIssue = checkItemName(name);
    if (nameIssue) {
      setRowIssue(describeNameIssue(nameIssue));
      return;
    }
    const minutes = clampItemMinutes(draftMinutes);
    if (draftMinutes.trim() !== "" && minutes === null) {
      setRowIssue(copy.timelineTimerInvalid);
      return;
    }
    const patch: ItemPatchIntent = {};
    if (name !== item.name) patch.name = name;
    if (minutes !== itemTimerMinutes(timers, item.id)) patch.timerMinutes = minutes;
    if (patch.name === undefined && patch.timerMinutes === undefined) {
      cancelEdit();
      return;
    }
    void onUpdate(item.id, patch).then((sent) => {
      /* 只有“发出去了”才收表单：没发出去时弹层留着让用户重试（照 `NotesStrip` 的先例） */
      if (sent) cancelEdit();
    });
  };

  const renderRow = (item: ItemPrefsLike, group: "pinned" | "recent", index: number) => {
    if (editingId === item.id) {
      return (
        <li key={item.id} className="qp-timeline-item-row qp-timeline-item-row--editing">
          <ItemEditForm
            draftName={draftName}
            draftMinutes={draftMinutes}
            busy={busy}
            issue={rowIssue}
            copy={copy}
            onNameChange={(value) => {
              setDraftName(value);
              setRowIssue(null);
            }}
            onMinutesChange={(value) => {
              setDraftMinutes(value);
              setRowIssue(null);
            }}
            onSave={() => saveEdit(item)}
            onCancel={cancelEdit}
          />
        </li>
      );
    }

    const minutes = itemTimerMinutes(timers, item.id);
    return (
      <li key={item.id} className="qp-timeline-item-row">
        <span className="qp-timeline-item-name" title={item.name}>{item.name}</span>
        {/* 分类是"改一条落一条"（不像名称/时长要进编辑态）：它不影响行的其它字段，
            多一层编辑态只会让"常用事项也能改分类"变成三步操作。 */}
        <ItemCategoryField
          value={item.categoryKey ?? null}
          options={categoryOptions}
          noneLabel={copy.timelineCategoryNone}
          ariaLabel={`${copy.timelineCategoryLabel} ${item.name}`}
          disabled={busy}
          onChange={(next) => { void onUpdate(item.id, { categoryKey: next }); }}
        />
        <span className="qp-timeline-item-timer">
          {minutes === null ? copy.timelineTimerOff : copy.timelineMinutesShort(minutes)}
        </span>
        <span className="qp-timeline-item-actions">
          {group === "pinned" ? (
            <>
              <button
                type="button"
                className="qp-timeline-icon-btn"
                aria-label={`${copy.timelineMoveUp} ${item.name}`}
                disabled={busy || index === 0}
                onClick={() => { void onMove(index, index - 1); }}
              >
                ↑
              </button>
              <button
                type="button"
                className="qp-timeline-icon-btn"
                aria-label={`${copy.timelineMoveDown} ${item.name}`}
                disabled={busy || index === pinned.length - 1}
                onClick={() => { void onMove(index, index + 1); }}
              >
                ↓
              </button>
              <button
                type="button"
                className="qp-link-btn qp-timeline-item-action"
                aria-label={`${copy.timelineUnpinAction} ${item.name}`}
                disabled={busy}
                onClick={() => { void onUpdate(item.id, { isPinned: false }); }}
              >
                {copy.timelineUnpinAction}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="qp-link-btn qp-timeline-item-action"
              aria-label={`${copy.timelinePinAction} ${item.name}`}
              disabled={busy}
              onClick={() => { void onUpdate(item.id, { isPinned: true }); }}
            >
              {copy.timelinePinAction}
            </button>
          )}
          <button
            type="button"
            className="qp-link-btn qp-timeline-item-action"
            aria-label={`${copy.timelineEditAction} ${item.name}`}
            disabled={busy}
            onClick={() => startEdit(item)}
          >
            {copy.timelineEditAction}
          </button>
        </span>
      </li>
    );
  };

  return (
    <div className="qp-timeline-prefs">
      {status === "loading" ? <p className="qp-empty">{UI_TEXT.common.loading}</p> : null}
      {status === "error" ? (
        <p className="qp-timeline-manage-issue" role="status">{UI_TEXT.common.readFailed}</p>
      ) : null}
      {issue ? <p className="qp-timeline-manage-issue" role="status">{issue}</p> : null}
      {status === "ready" ? (
        <>
          <section className="qp-timeline-prefs-group">
            <h4 className="qp-timeline-group-title">{copy.timelinePinnedGroup}</h4>
            {pinned.length === 0 ? (
              <p className="qp-empty">{copy.timelineManageEmpty}</p>
            ) : (
              <ul className="qp-timeline-item-list">
                {pinned.map((item, index) => renderRow(item, "pinned", index))}
              </ul>
            )}
          </section>
          {showRecent ? (
            <section className="qp-timeline-prefs-group">
              <h4 className="qp-timeline-group-title">{copy.timelineRecentGroup}</h4>
              {recent.length === 0 ? (
                <p className="qp-empty">{copy.timelineRecentEmpty}</p>
              ) : (
                <ul className="qp-timeline-item-list">
                  {recent.map((item, index) => renderRow(item, "recent", index))}
                </ul>
              )}
            </section>
          ) : null}
          <div className="qp-timeline-category-manage-row">
            <button
              type="button"
              className="qp-link-btn qp-timeline-item-action"
              disabled={busy}
              onClick={onManageCategories}
            >
              {copy.timelineManageCategories}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
