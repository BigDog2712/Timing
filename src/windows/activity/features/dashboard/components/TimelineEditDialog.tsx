/**
 * 「编辑事项」弹层（0.13 · 1.6）：**先选事项，再改名称 / 计时模式 / 标签**。
 *
 * ## 候选 = 今日时间线上的事项（主人口径 2026-11-14）
 *
 * 「编辑事项指对今日时间线上的事项进行编辑」。所以候选清单由宿主的
 * `todayTimedItemIds(items)` 给（今天真的计过时的事项，时间线顺序），**不是**全量
 * `items`：库里可能建过二十几个事项（半年前的「测试」「测试2」），那是「事项管理」
 * 的分组列表该干的事；这一颗入口的语境是"我刚在卡上看到的那几行"。
 * `todayItemIds` 的顺序就是时间线顺序 —— 不用再按 `updatedAt` 排（那会让同一份清单
 * 在卡上和弹层里两种顺序）。
 *
 * 为什么不合并进「事项管理」：那一层是"常用 / 近期两组 + 行内编辑"（T03 的口径），
 * 这一颗补的是**另一条路** —— 用户心里已经有那个事项，点开就直接改。
 *
 * ## 意图恰一条（V-1.6c）
 *
 * 保存 = **一条** `{action:"update_item", id, name, timerMinutes, tags?}`：
 *   · `name` 恒发（表单里名字是必填位）；
 *   · `timerMinutes` 三态：正计时 = `null`（清默认时长）、倒计时填数字 = 设值 ——
 *     与宿主 `ItemsPrefsMenu.readMinutes()` 同口径，`clampItemMinutes` 在这里解析；
 *     倒计时留空就地提示，不发意图；
 *   · `tags` 只在用户动过标签时带上（没动过就不该因为打开过弹层而重写一遍）；
 *   · 没有第二发：置顶/排序不归这个弹层管（那是「事项管理」的事），**别顺手多发**。
 *
 * 表单的「正计时 / 倒计时」与悬浮条快捷新建同一套 `ITEM_EDITOR_COPY` 与控件。
 *
 * ## [0.13 fix] 另挂了「绑定应用」一栏（不属于这张表单）
 *
 * 「我启动了燕云，但没开始计时」的根因之一是事项视角**根本没有绑定入口**。这一栏
 * （`ItemAppBindingField`）就地改就地落，**不经过保存键**：它与"名称 + 计时模式 +
 * 标签"是两件事，各自有各自的写入路径（配置表 + 镜像宿主 `item_app`）。所以上面那条
 * "恰一条意图"说的是**保存键**，不是整个弹层。
 *
 * ## [2026-11-20] 「改起止」也住进来（原独立弹层下线）
 *
 * 时间线行右侧那颗悬停才浮出的「改起止」已删除（同一个动作藏在 hover 里，用户永远
 * 找不到）；它并入这张弹层的「今日记录」区（`ItemRecordTimeSection`），入口就是
 * 用户已经会用的「编辑事项」。那一区只改**时刻**（`HH:mm`），日期不摆在界面上；
 * 同样是就地改就地落（每段一条 `update_record_time`），**不走**保存键。
 *
 * ## 为什么用 useItemPrefs（而不是 useTodayItems）
 *
 * 编辑的是**事项本身**（名字 + `settings.itemsTimers` 的默认时长），不是"今天那几段记录"；
 * `useItemPrefs(true)` 的读法、pending 表（改名不被刷新覆盖）都与「事项管理」同一条路。
 * 候选的**范围**由宿主给 `todayItemIds`，这一层只负责"在这批里挑一个"。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { emitHostIntent, type HostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { DASHBOARD_COPY } from "../copy.ts";
import { ITEM_EDITOR_COPY } from "../copyItemEditor.ts";
import { useItemPrefs } from "../hooks/useItemPrefs.ts";
import { useItemTagSnapshot } from "../hooks/useItemTagSnapshot.ts";
import { clampItemMinutes, itemTimerMinutes } from "../services/itemPrefs.ts";
import { checkItemName, ITEM_NAME_MAX_LEN, type ItemNameIssue } from "../services/timelineItemName.ts";
import ItemAppBindingField from "./ItemAppBindingField.tsx";
import ItemEditForm from "./ItemEditForm.tsx";
import ItemRecordTimeSection from "./ItemRecordTimeSection.tsx";
import ItemTagField from "./ItemTagField.tsx";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 今日时间线上的事项 id（**时间线顺序**；不含今天没计过时的事项，理由见头注释） */
  todayItemIds: readonly number[];
  /** 交给 `useTodayItems.applyLocalRename`：本地先改，别让下一次刷新覆盖回去 */
  onLocalRename: (itemId: number, name: string) => void;
  /** 指定候选集（事项管理行点进来时只放这一条）；缺省 = `todayItemIds` */
  itemIds?: readonly number[];
  /** 直接从这一条开始编辑（跳过候选列表）；缺省 = 先选事项 */
  initialItemId?: number | null;
}

export default function TimelineEditDialog({
  open,
  onClose,
  todayItemIds,
  onLocalRename,
  itemIds,
  initialItemId = null,
}: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const editorCopy = ITEM_EDITOR_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const { items, timers, status, applyLocalItem, applyLocalTimer } = useItemPrefs(open);
  const tagSnapshot = useItemTagSnapshot(open);
  const sourceIds = itemIds ?? todayItemIds;

  const listRef = useRef<HTMLUListElement | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftMinutes, setDraftMinutes] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagsTouched, setTagsTouched] = useState(false);
  const [tagHint, setTagHint] = useState<string | null>(null);
  const [timerMode, setTimerMode] = useState<"up" | "down">("up");
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* 候选 = 今日时间线上那几件，**按时间线顺序**（`todayItemIds` 已经是升序）。
     用 Map 记位次而不是每次 `indexOf`：列表最多几十条，但 `indexOf` 在 sort 里
     是 O(n²logn)，而且读者会误以为"顺序是排序算出来的"。 */
  const orderOf = useMemo(
    () => new Map(sourceIds.map((id, index) => [id, index] as const)),
    [sourceIds],
  );
  const candidates = useMemo(
    () => items
      .filter((item) => !item.isSystem && orderOf.has(item.id))
      .sort((a, b) => (orderOf.get(a.id) ?? 0) - (orderOf.get(b.id) ?? 0)),
    [items, orderOf],
  );

  const selected = candidates.find((item) => item.id === selectedId) ?? null;

  /* 弹层每次打开都是干净的：清选择与草稿（关闭后的残留草稿会让下一次打开"看起来改过了"） */
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setDraftName("");
      setDraftMinutes("");
      setDraftTags([]);
      setTagsTouched(false);
      setTagHint(null);
      setTimerMode("up");
      setIssue(null);
      setBusy(false);
    }
  }, [open]);

  const pick = useCallback((itemId: number) => {
    const item = candidates.find((entry) => entry.id === itemId);
    if (!item) return;
    setSelectedId(item.id);
    setDraftName(item.name);
    const minutes = itemTimerMinutes(timers, item.id);
    setDraftMinutes(minutes === null ? "" : String(minutes));
    setTimerMode(minutes === null ? "up" : "down");
    setDraftTags(tagSnapshot.byItem.get(item.id) ?? []);
    setTagsTouched(false);
    setTagHint(null);
    setIssue(null);
  }, [candidates, timers, tagSnapshot.byItem]);

  /* 从「事项管理」行点进来：候选集只有那一条，加载完直接进入表单 */
  useEffect(() => {
    if (!open || initialItemId === null || selectedId === initialItemId) return;
    const item = candidates.find((entry) => entry.id === initialItemId);
    if (item) pick(item.id);
  }, [open, initialItemId, candidates, selectedId, pick]);

  /* 标签快照与事项清单是两条并发读，`pick` 可能先跑、快照后到。快照到达时把这一条的
     标签并进草稿（只并集、不覆盖）：否则界面显示"没有标签"，用户加一个再保存就会把
     原有标签整组覆盖掉（`update_item.tags` 是全量）。用户随后的删除不会被这里加回来
     —— 这条 effect 只在换事项 / 快照变化时跑，不跟 `tagsTouched` 走。 */
  const selectedItemId = selected?.id ?? null;
  useEffect(() => {
    if (!open || selectedItemId === null) return;
    const loaded = tagSnapshot.byItem.get(selectedItemId);
    if (!loaded) return;
    setDraftTags((current) => [...current, ...loaded.filter((tag) => !current.includes(tag))]);
  }, [open, selectedItemId, tagSnapshot.byItem]);

  const describeNameIssue = (code: ItemNameIssue): string =>
    code === "empty" ? copy.timelineNameEmpty : copy.timelineNameTooLong(ITEM_NAME_MAX_LEN);

  const save = () => {
    if (!selected || busy) return;
    const name = draftName.trim();
    const nameIssue = checkItemName(name);
    if (nameIssue) {
      setIssue(describeNameIssue(nameIssue));
      return;
    }
    const minutes = clampItemMinutes(draftMinutes);
    if (timerMode === "down" && draftMinutes.trim() === "") {
      setIssue(editorCopy.timerRequired);
      return;
    }
    if (draftMinutes.trim() !== "" && minutes === null) {
      setIssue(copy.timelineTimerInvalid);
      return;
    }
    setBusy(true);
    /* 恰一条意图（V-1.6c）：`timerMinutes` 三态（数字 / null / 不发）——
       这里数字与 null 都**显式发**：表单里那个输入框是有语义的（留空 = 清默认时长），
       与"行内编辑只发改了的字段"不同：弹层的语义是"这张表单就是该事项的新状态"。
       标签只在用户动过时带上：没动过就不该因为打开过弹层而重写一遍。 */
    const intent: HostIntent = {
      action: "update_item",
      id: selected.id,
      name,
      timerMinutes: timerMode === "down" ? minutes : null,
      ...(tagsTouched ? { tags: draftTags } : {}),
    };
    void emitHostIntent(intent)
      .then((sent) => {
        setBusy(false);
        if (!sent) {
          setIssue(copy.timelineSaveFailed);
          return;
        }
        applyLocalItem(selected.id, { name });
        applyLocalTimer(selected.id, timerMode === "down" ? minutes : null);
        onLocalRename(selected.id, name);
        onClose();
      });
  };

  return (
    <QuietDialog
      open={open}
      title={copy.timelineEditItem}
      surfaceClassName="at-timeline-manage-dialog"
      onClose={onClose}
      actions={(
        <>
          <button
            type="button"
            className="at-button at-button-compact at-button-secondary"
            onClick={onClose}
          >
            {UI_TEXT.dialog.cancel}
          </button>
          <button
            type="button"
            className="at-button at-button-compact at-button-primary"
            disabled={!selected || busy}
            onClick={save}
          >
            {UI_TEXT.dialog.confirm}
          </button>
        </>
      )}
    >
      <div className="at-timeline-edit">
        {status === "loading" ? <p className="at-empty">{UI_TEXT.common.loading}</p> : null}
        {status === "error" ? (
          <p className="at-timeline-manage-issue" role="status">{UI_TEXT.common.readFailed}</p>
        ) : null}
        {status === "ready" ? (
          <>
            {initialItemId === null ? (
              <ul ref={listRef} className="at-timeline-edit-list at-scroll-region" aria-label={copy.timelineEditItem}>
                {candidates.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="at-timeline-edit-choice"
                      data-selected={item.id === selectedId || undefined}
                      aria-pressed={item.id === selectedId}
                      onClick={() => pick(item.id)}
                    >
                      <span className="at-timeline-edit-name" title={item.name}>{item.name}</span>
                      <span className="at-timeline-item-timer">
                        {itemTimerMinutes(timers, item.id) === null
                          ? copy.timelineTimerOff
                          : copy.timelineMinutesShort(itemTimerMinutes(timers, item.id) as number)}
                      </span>
                    </button>
                  </li>
                ))}
                {candidates.length === 0 ? <li className="at-empty">{copy.timelineEditEmpty}</li> : null}
              </ul>
            ) : null}
            {selected ? (
              <>
                <ItemEditForm
                  draftName={draftName}
                  draftMinutes={draftMinutes}
                  busy={busy}
                  issue={issue}
                  copy={copy}
                  timerMode={timerMode}
                  onTimerModeChange={(mode) => {
                    setTimerMode(mode);
                    setIssue(null);
                  }}
                  onNameChange={(value) => {
                    setDraftName(value);
                    setIssue(null);
                  }}
                  onMinutesChange={(value) => {
                    setDraftMinutes(value);
                    setTimerMode(value.trim() === "" ? "up" : "down");
                    setIssue(null);
                  }}
                  onSave={save}
                  onCancel={onClose}
                />
                <ItemTagField
                  value={draftTags}
                  options={tagSnapshot.options}
                  suggestText={draftName}
                  disabled={busy}
                  onHint={(message) => setTagHint(message || null)}
                  onChange={(next) => {
                    setDraftTags(next);
                    setTagsTouched(true);
                    setIssue(null);
                  }}
                />
                {tagHint ? <p className="at-timeline-manage-issue" role="status">{tagHint}</p> : null}
                {/* [0.13 fix] 「绑定应用」在弹层里就改就落（不走本弹层的保存键）：
                    它是另一件事（应用↔事项），与"名称 + 默认时长"这一张表单的语义不同源。 */}
                <ItemAppBindingField itemId={selected.id} enabled={open} />
                {/* 「今日记录」只改时刻（原「改起止」弹层）：同样就走就地落，不走保存键 */}
                <ItemRecordTimeSection itemId={selected.id} itemName={selected.name} />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </QuietDialog>
  );
}
