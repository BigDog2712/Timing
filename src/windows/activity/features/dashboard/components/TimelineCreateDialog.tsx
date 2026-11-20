/**
 * 「＋ 新建事项」弹层（[0.13] 从 `TimelineManage` 抽出来的独立挂载件）。
 *
 * 为什么抽：新建要与悬浮条快捷新建同一套能力（计时方式 / 标签 / 应用 / 创建后开始），
 * 容器里那段表单从"两个输入框 + 一个勾选"涨到要同时管标签快照、应用候选与计时模式。
 * `TimelineManage` 自己还压着「事项管理」那个弹层与两条意图通道，300 行棘轮不够分。
 *
 * **分类不在这里**（2026-11-20 主人口径）：新建只收名称与计时配置；分类归「事项管理」，
 * 建完再改，不在新建时做第二次决定。
 *
 * 三条口径照旧（改动前就在 `TimelineManage` 里，别丢）：
 *   1. 「设为常用」**默认不勾** —— 新建"可以"加进常用，不是强制；勾了才补 `max+1` 的落点；
 *   2. 意图**没有回执**：`emitHostIntent` 返回 false 时一步都不许推进本地状态，弹层留着重试；
 *   3. 建成功要**复位**表单（尤其"设为常用"这一格），否则第二次新建会静默继承上一次的勾选。
 */
import { useCallback, useRef, useState } from "react";

import { emitHostIntent, type HostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { ItemPrefsLike } from "../services/itemPrefs.ts";
import { clampItemMinutes, nextSortOrder } from "../services/itemPrefs.ts";
import { checkItemName, ITEM_NAME_MAX_LEN, type ItemNameIssue } from "../services/timelineItemName.ts";
import type { TimelineManageCopy } from "../copyTimeline.ts";
import { useItemTagSnapshot } from "../hooks/useItemTagSnapshot.ts";
import { ITEM_EDITOR_COPY } from "../copyItemEditor.ts";
import ItemAppSelect from "./ItemAppSelect.tsx";
import ItemTagField from "./ItemTagField.tsx";

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
  const editorCopy = ITEM_EDITOR_COPY[useLocale()];
  const tagSnapshot = useItemTagSnapshot(open);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("");
  const [timerMode, setTimerMode] = useState<"up" | "down">("up");
  const [tags, setTags] = useState<string[]>([]);
  const [appKey, setAppKey] = useState<string | null>(null);
  const [pin, setPin] = useState(false);
  const [startAfterCreate, setStartAfterCreate] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [tagHint, setTagHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const minutesInvalid = (timerMode === "down" && minutes.trim() === "")
    || (minutes.trim() !== "" && clampItemMinutes(minutes) === null);

  const describeNameIssue = useCallback(
    (code: ItemNameIssue): string =>
      code === "empty" ? copy.timelineNameEmpty : copy.timelineNameTooLong(ITEM_NAME_MAX_LEN),
    [copy],
  );

  const reset = useCallback(() => {
    setName("");
    setMinutes("");
    setTimerMode("up");
    setTags([]);
    setAppKey(null);
    setPin(false);
    setStartAfterCreate(false);
    setIssue(null);
    setTagHint(null);
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
    const timerMinutes = timerMode === "down" ? clampItemMinutes(minutes) : null;
    /* 标签 / 应用 / 创建后开始只在用户真的填了时才带：旧夹具与旧宿主都认这几项缺省。 */
    const extra = {
      ...(tags.length > 0 ? { tags } : {}),
      ...(appKey ? { appKey } : {}),
      ...(startAfterCreate ? { start: true } : {}),
    };
    const intent: HostIntent = pin
      ? { action: "create_item", name: trimmed, isPinned: true, timerMinutes, sortOrder: nextSortOrder(pinned), ...extra }
      : { action: "create_item", name: trimmed, isPinned: false, timerMinutes, ...extra };
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
    busy, copy, describeNameIssue, minutes, minutesInvalid, name, onClose, onLocalCreate,
    pin, pinned, reset, timerMode, tags, appKey, startAfterCreate,
  ]);

  return (
    <QuietDialog
      open={open}
      title={copy.timelineCreateTitle}
      surfaceClassName="at-timeline-manage-dialog"
      initialFocusRef={inputRef}
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
            disabled={busy || name.trim().length === 0}
            onClick={submit}
          >
            {UI_TEXT.dialog.confirm}
          </button>
        </>
      )}
    >
      <div className="at-timeline-manage-form">
        <input
          ref={inputRef}
          className="at-input at-timeline-manage-input"
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
        <div className="at-timeline-manage-field">
          <span className="at-timeline-manage-label">{editorCopy.timerModeLabel}</span>
          <div className="at-timer-mode" role="group" aria-label={editorCopy.timerModeLabel}>
            <button
              type="button"
              className="at-timer-mode-btn"
              aria-pressed={timerMode === "up"}
              onClick={() => {
                setTimerMode("up");
                setMinutes("");
                setIssue(null);
              }}
            >
              {editorCopy.timerUp}
            </button>
            <button
              type="button"
              className="at-timer-mode-btn"
              aria-pressed={timerMode === "down"}
              onClick={() => {
                setTimerMode("down");
                setIssue(null);
                timerRef.current?.focus();
              }}
            >
              {editorCopy.timerDown}
            </button>
          </div>
          <input
            ref={timerRef}
            className="at-input at-timeline-manage-timer"
            value={minutes}
            inputMode="numeric"
            placeholder={copy.timelineTimerPlaceholder}
            aria-label={copy.timelineTimerLabel}
            aria-invalid={minutesInvalid ? true : undefined}
            onChange={(event) => {
              const value = event.target.value;
              setMinutes(value);
              setTimerMode(value.trim() === "" ? "up" : "down");
              setIssue(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
        </div>
        <ItemTagField
          value={tags}
          options={tagSnapshot.options}
          suggestText={name}
          disabled={busy}
          onHint={(message) => setTagHint(message || null)}
          onChange={(next) => {
            setTags(next);
            setIssue(null);
          }}
        />
        <label className="at-timeline-manage-field">
          <span className="at-timeline-manage-label">{editorCopy.appsLabel}</span>
          <ItemAppSelect enabled={open} value={appKey} onChange={setAppKey} disabled={busy} />
        </label>
        <label className="at-timeline-manage-check">
          <input
            type="checkbox"
            checked={pin}
            onChange={(event) => setPin(event.target.checked)}
          />
          <span>{copy.timelinePinAction}</span>
        </label>
        <label className="at-timeline-manage-check">
          <input
            type="checkbox"
            checked={startAfterCreate}
            onChange={(event) => setStartAfterCreate(event.target.checked)}
          />
          <span>{editorCopy.startAfterCreate}</span>
        </label>
        {tagHint ? <p className="at-timeline-manage-issue" role="status">{tagHint}</p> : null}
        {issue ? (
          <p className="at-timeline-manage-issue" role="status">{issue}</p>
        ) : null}
      </div>
    </QuietDialog>
  );
}
