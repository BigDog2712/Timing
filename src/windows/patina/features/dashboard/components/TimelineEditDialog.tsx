/**
 * 「编辑事项」弹层（0.13 · 1.6）：**先选事项，再改名称 + 默认时长**。
 *
 * 为什么不直接摊开全表：「事项管理」弹层已经是"常用 / 近期两组 + 行内编辑"（T03 前一轮
 * 的口径），这一颗卡底入口补的是**另一条**路 —— 用户心里已经有那个事项的名字，
 * 想直接搜出来改。选择区是全部事项（含近期/常用，按 `updatedAt` 倒序），选中后
 * 展开的编辑表单与 `TimelineItemRows` 的行内编辑是**同一个** `ItemEditForm`。
 *
 * ## 意图恰一条（V-1.6c）
 *
 * 保存 = **一条** `{action:"update_item", id, name, timerMinutes}`：
 *   · `name` 恒发（表单里名字是必填位）；
 *   · `timerMinutes` 三态：留空 = `null`（清默认时长，回正计时）、数字 = 设值 ——
 *     与宿主 `ItemsPrefsMenu.readMinutes()` 同口径，`clampItemMinutes` 在这里解析；
 *   · 没有第二发：置顶/排序不归这个弹层管（那是「事项管理」的事），**别顺手多发**。
 *
 * ## 为什么用 useItemPrefs（而不是 useTodayItems）
 *
 * 编辑的是**事项本身**（全量列表 + `settings.itemsTimers`），不是"今天有记录的事项"；
 * `useItemPrefs(true)` 的读法、pending 表（改名不被刷新覆盖）都与「事项管理」同一条路。
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { DASHBOARD_COPY } from "../copy.ts";
import { useItemPrefs } from "../hooks/useItemPrefs.ts";
import { clampItemMinutes, itemTimerMinutes } from "../services/itemPrefs.ts";
import { checkItemName, ITEM_NAME_MAX_LEN, type ItemNameIssue } from "../services/timelineItemName.ts";
import ItemEditForm from "./ItemEditForm.tsx";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 交给 `useTodayItems.applyLocalRename`：本地先改，别让下一次刷新覆盖回去 */
  onLocalRename: (itemId: number, name: string) => void;
}

export default function TimelineEditDialog({ open, onClose, onLocalRename }: Props) {
  const copy = DASHBOARD_COPY[useLocale()];
  const UI_TEXT = useLocaleText();
  const { items, timers, status, applyLocalItem, applyLocalTimer } = useItemPrefs(open);

  const listRef = useRef<HTMLUListElement | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftMinutes, setDraftMinutes] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* 按最近动过的排前面（选择列表的口径：用户刚在药丸里动过的事项排最前） */
  const candidates = useMemo(
    () => [...items].filter((item) => !item.isSystem).sort((a, b) => b.updatedAt - a.updatedAt || a.id - b.id),
    [items],
  );

  const selected = candidates.find((item) => item.id === selectedId) ?? null;

  /* 弹层每次打开都是干净的：清选择与草稿（关闭后的残留草稿会让下一次打开"看起来改过了"） */
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setDraftName("");
      setDraftMinutes("");
      setIssue(null);
      setBusy(false);
    }
  }, [open]);

  const pick = (itemId: number) => {
    const item = candidates.find((entry) => entry.id === itemId);
    if (!item) return;
    setSelectedId(item.id);
    setDraftName(item.name);
    const minutes = itemTimerMinutes(timers, item.id);
    setDraftMinutes(minutes === null ? "" : String(minutes));
    setIssue(null);
  };

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
    if (draftMinutes.trim() !== "" && minutes === null) {
      setIssue(copy.timelineTimerInvalid);
      return;
    }
    setBusy(true);
    /* 恰一条意图（V-1.6c）：`timerMinutes` 三态（数字 / null / 不发）——
       这里数字与 null 都**显式发**：表单里那个输入框是有语义的（留空 = 清默认时长），
       与"行内编辑只发改了的字段"不同：弹层的语义是"这张表单就是该事项的新状态"。 */
    void emitHostIntent({ action: "update_item", id: selected.id, name, timerMinutes: minutes })
      .then((sent) => {
        setBusy(false);
        if (!sent) {
          setIssue(copy.timelineSaveFailed);
          return;
        }
        applyLocalItem(selected.id, { name });
        applyLocalTimer(selected.id, minutes);
        onLocalRename(selected.id, name);
        onClose();
      });
  };

  return (
    <QuietDialog
      open={open}
      title={copy.timelineEditItem}
      surfaceClassName="qp-timeline-manage-dialog"
      onClose={onClose}
      actions={(
        <>
          <button
            type="button"
            className="qp-button qp-button-compact qp-button-secondary"
            onClick={onClose}
          >
            {UI_TEXT.dialog.cancel}
          </button>
          <button
            type="button"
            className="qp-button qp-button-compact qp-button-primary"
            disabled={!selected || busy}
            onClick={save}
          >
            {UI_TEXT.dialog.confirm}
          </button>
        </>
      )}
    >
      <div className="qp-timeline-edit">
        {status === "loading" ? <p className="qp-empty">{UI_TEXT.common.loading}</p> : null}
        {status === "error" ? (
          <p className="qp-timeline-manage-issue" role="status">{UI_TEXT.common.readFailed}</p>
        ) : null}
        {status === "ready" ? (
          <>
            <ul ref={listRef} className="qp-timeline-edit-list qp-scroll-region" aria-label={copy.timelineEditItem}>
              {candidates.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="qp-timeline-edit-choice"
                    data-selected={item.id === selectedId || undefined}
                    aria-pressed={item.id === selectedId}
                    onClick={() => pick(item.id)}
                  >
                    <span className="qp-timeline-edit-name" title={item.name}>{item.name}</span>
                    <span className="qp-timeline-item-timer">
                      {itemTimerMinutes(timers, item.id) === null
                        ? copy.timelineTimerOff
                        : copy.timelineMinutesShort(itemTimerMinutes(timers, item.id) as number)}
                    </span>
                  </button>
                </li>
              ))}
              {candidates.length === 0 ? <li className="qp-empty">{copy.timelineManageEmpty}</li> : null}
            </ul>
            {selected ? (
              <ItemEditForm
                draftName={draftName}
                draftMinutes={draftMinutes}
                busy={busy}
                issue={issue}
                copy={copy}
                onNameChange={(value) => {
                  setDraftName(value);
                  setIssue(null);
                }}
                onMinutesChange={(value) => {
                  setDraftMinutes(value);
                  setIssue(null);
                }}
                onSave={save}
                onCancel={onClose}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </QuietDialog>
  );
}
