/**
 * 事项编辑表单（名称 + 默认时长）—— [0.13 · 1.6] 从 `TimelineItemRows` 的行内编辑态
 * **抽出来**的独立挂载件，两个消费者：
 *   · `TimelineItemRows`（「事项管理」弹层的行内就地展开）；
 *   · `TimelineEditDialog`（卡底「编辑事项」弹层：先选事项，再改这张表单）。
 *
 * 为什么必须抽：两处要是各自写一遍"名称 + 分钟 + Enter 保存 + Escape 取消"，
 * 校验口径（空名 / 超长 / 1–1440）迟早漂移。这里是**纯展示**：不发意图、不碰数据，
 * 一切写动作经 `onSave` 交回容器 —— "发出去没有"只有容器知道（事件桥没有回执）。
 *
 * 两条交互纪律（照搬原行内编辑，别改）：
 *   1. Enter 保存、Escape 取消，且 Escape 必须 `preventDefault()` ——
 *      否则 `QuietDialog` 的 window 级 Escape 会把整个弹层关掉（表单没保存就全没了）；
 *   2. 保存键 `disabled={busy}`：意图发出中不许连点（没有回执，连点 = 多发意图）。
 */
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { KeyboardEvent } from "react";
import type { TimelineManageCopy } from "../copyTimeline.ts";
import { ITEM_NAME_MAX_LEN } from "../services/timelineItemName.ts";

interface Props {
  draftName: string;
  /** 分钟输入的**原样字符串**（空串 = 留空 = 正计时）；解析与钳制在容器侧 */
  draftMinutes: string;
  busy: boolean;
  /** 容器给的校验/失败文案；`null` = 没有 */
  issue: string | null;
  /** `aria-invalid`：issue 存在时输入框标红 */
  copy: TimelineManageCopy;
  onNameChange: (value: string) => void;
  onMinutesChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function ItemEditForm({
  draftName,
  draftMinutes,
  busy,
  issue,
  copy,
  onNameChange,
  onMinutesChange,
  onSave,
  onCancel,
}: Props) {
  const UI_TEXT = useLocaleText();

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="qp-timeline-item-editor">
      <input
        className="qp-input qp-timeline-manage-input"
        value={draftName}
        maxLength={ITEM_NAME_MAX_LEN}
        autoFocus
        aria-label={copy.timelineEditAction}
        aria-invalid={issue ? true : undefined}
        onChange={(event) => onNameChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <input
        className="qp-input qp-timeline-manage-timer"
        value={draftMinutes}
        inputMode="numeric"
        aria-label={copy.timelineTimerLabel}
        placeholder={copy.timelineTimerPlaceholder}
        onChange={(event) => onMinutesChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="qp-timeline-item-editor-actions">
        <button
          type="button"
          className="qp-button qp-button-compact qp-button-primary"
          disabled={busy}
          onClick={onSave}
        >
          {copy.timelineSaveAction}
        </button>
        <button
          type="button"
          className="qp-button qp-button-compact qp-button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          {UI_TEXT.dialog.cancel}
        </button>
      </span>
      {issue ? (
        <p className="qp-timeline-manage-issue" role="status">{issue}</p>
      ) : null}
    </div>
  );
}
