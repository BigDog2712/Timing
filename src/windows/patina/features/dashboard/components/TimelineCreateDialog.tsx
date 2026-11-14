/**
 * 「＋ 新建事项」弹层（[0.13] 从 `TimelineManage` 抽出来的独立挂载件）。
 *
 * 为什么抽：本轮给新建加了**分类**（下拉 + 顺手打开分类管理），容器里那段表单
 * 从"两个输入框 + 一个勾选"涨到要同时管候选加载、管理弹层的开合与刷新。
 * `TimelineManage` 自己还压着「事项管理」那个弹层与两条意图通道，300 行棘轮不够分。
 *
 * 三条口径照旧（改动前就在 `TimelineManage` 里，别丢）：
 *   1. 「设为常用」**默认不勾** —— 新建"可以"加进常用，不是强制；勾了才补 `max+1` 的落点；
 *   2. 意图**没有回执**：`emitHostIntent` 返回 false 时一步都不许推进本地状态，弹层留着重试；
 *   3. 建成功要**复位**表单（尤其"设为常用"这一格），否则第二次新建会静默继承上一次的勾选。
 */
import { useCallback, useRef, useState } from "react";

import { emitHostIntent, type HostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ItemPrefsLike } from "../services/itemPrefs.ts";
import { clampItemMinutes, nextSortOrder } from "../services/itemPrefs.ts";
import { checkItemName, ITEM_NAME_MAX_LEN, type ItemNameIssue } from "../services/timelineItemName.ts";
import type { TimelineManageCopy } from "../copyTimeline.ts";
import DataCategoryManageDialog from "../../data/components/DataCategoryManageDialog.tsx";
import { useItemCategoryOptions } from "../hooks/useItemCategoryOptions.ts";
import ItemCategoryField from "./ItemCategoryField.tsx";

interface Props {
  open: boolean;
  copy: TimelineManageCopy;
  /** 常用组（算「设为常用」的落点 `max(sortOrder)+1`） */
  pinned: readonly ItemPrefsLike[];
  onClose: () => void;
  onLocalCreate: (name: string) => void;
}

export default function TimelineCreateDialog({ open, copy, pinned, onClose, onLocalCreate }: Props) {
  const UI_TEXT = useLocaleText();
  const { options, reload } = useItemCategoryOptions(open);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("");
  const [pin, setPin] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const minutesInvalid = minutes.trim() !== "" && clampItemMinutes(minutes) === null;

  const describeNameIssue = useCallback(
    (code: ItemNameIssue): string =>
      code === "empty" ? copy.timelineNameEmpty : copy.timelineNameTooLong(ITEM_NAME_MAX_LEN),
    [copy],
  );

  const reset = useCallback(() => {
    setName("");
    setMinutes("");
    setPin(false);
    setCategory(null);
    setIssue(null);
  }, []);

  const submit = useCallback(() => {
    if (busy) return;
    const trimmed = name.trim();
    const nameIssue = checkItemName(trimmed);
    if (nameIssue) {
      setIssue(describeNameIssue(nameIssue));
      return;
    }
    if (minutesInvalid) {
      setIssue(copy.timelineTimerInvalid);
      return;
    }
    const timerMinutes = clampItemMinutes(minutes);
    /* `categoryKey` 显式带给意图：`null` = 未分类（与"没给"在落库上等价，但这里给了，
       是为了让载荷读起来是"用户选了未分类"，而不是"这一版忘了带分类"）。 */
    const intent: HostIntent = pin
      ? { action: "create_item", name: trimmed, isPinned: true, timerMinutes, sortOrder: nextSortOrder(pinned), categoryKey: category }
      : { action: "create_item", name: trimmed, isPinned: false, timerMinutes, categoryKey: category };
    setBusy(true);
    void emitHostIntent(intent).then((sent) => {
      setBusy(false);
      if (!sent) {
        setIssue(copy.timelineSaveFailed);
        return;
      }
      onLocalCreate(trimmed);
      reset();
      onClose();
    });
  }, [
    busy, category, copy, describeNameIssue, minutes, minutesInvalid, name, onClose, onLocalCreate,
    pin, pinned, reset,
  ]);

  return (
    <>
      <QuietDialog
        open={open}
        title={copy.timelineCreateTitle}
        surfaceClassName="qp-timeline-manage-dialog"
        initialFocusRef={inputRef}
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
              disabled={busy || name.trim().length === 0}
              onClick={submit}
            >
              {UI_TEXT.dialog.confirm}
            </button>
          </>
        )}
      >
        <div className="qp-timeline-manage-form">
          <input
            ref={inputRef}
            className="qp-input qp-timeline-manage-input"
            value={name}
            maxLength={ITEM_NAME_MAX_LEN}
            placeholder={copy.timelineCreatePlaceholder}
            aria-label={copy.timelineCreatePlaceholder}
            aria-invalid={issue ? true : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setIssue(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
          <label className="qp-timeline-manage-field">
            <span className="qp-timeline-manage-label">{copy.timelineTimerLabel}</span>
            <input
              className="qp-input qp-timeline-manage-timer"
              value={minutes}
              inputMode="numeric"
              placeholder={copy.timelineTimerPlaceholder}
              aria-label={copy.timelineTimerLabel}
              aria-invalid={minutesInvalid ? true : undefined}
              onChange={(event) => {
                setMinutes(event.target.value);
                setIssue(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submit();
              }}
            />
          </label>
          <label className="qp-timeline-manage-field">
            <span className="qp-timeline-manage-label">{copy.timelineCategoryLabel}</span>
            {/* 「管理分类」放在标签行里：新建时顺手加一个分类，不用退出去再回来 */}
            <ItemCategoryField
              value={category}
              options={options}
              noneLabel={copy.timelineCategoryNone}
              ariaLabel={copy.timelineCategoryLabel}
              disabled={busy}
              manageAction={{
                label: copy.timelineManageCategories,
                onManage: () => setManageOpen(true),
              }}
              onChange={setCategory}
            />
          </label>
          <label className="qp-timeline-manage-check">
            <input
              type="checkbox"
              checked={pin}
              onChange={(event) => setPin(event.target.checked)}
            />
            <span>{copy.timelinePinAction}</span>
          </label>
          {issue ? (
            <p className="qp-timeline-manage-issue" role="status">{issue}</p>
          ) : null}
        </div>
      </QuietDialog>
      {/* 管理弹层挂在新建弹层**之外**：它自己 portal 到 body，套在 `QuietDialog` 里
          会变成两层叠加，Escape 与焦点陷阱各关一层、顺序不可预期。
          增删改分类成功后必须重取候选，否则新建时刚建的分类在下拉里还看不到。 */}
      <DataCategoryManageDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={reload}
      />
    </>
  );
}
