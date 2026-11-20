/**
 * 事项标签行（分析窗自写的一份，与药丸 `PanelTagField` 同交互，L9 不能 import）。
 *
 * 回车 / 逗号确认、退格在空输入时删最后一个、datalist 候选、AI 按名称建议。
 * AI 新建的标签在这里就补定义行：`set_item_tags` 只写引用，不补定义会在标签树里消失。
 */
import { useId, useState } from "react";

import { useLocale } from "../../../shared/i18n/index.ts";
import { normalizeTagPath } from "../../../../shared/tags/normalize.ts";
import { aiSuggestTags } from "../../../platform/desktop/hostAiGateway.ts";
import { createTagDefinition } from "../../../platform/persistence/tagAdminGateway.ts";
import { ITEM_EDITOR_COPY } from "../copyItemEditor.ts";

const MAX_TAGS = 8;

interface Props {
  value: readonly string[];
  options: readonly string[];
  onChange: (tags: string[]) => void;
  /** AI 用的文本（新事项名称） */
  suggestText: string;
  disabled?: boolean;
  onHint?: (message: string) => void;
}

export default function ItemTagField({
  value,
  options,
  onChange,
  suggestText,
  disabled = false,
  onHint,
}: Props) {
  const copy = ITEM_EDITOR_COPY[useLocale()];
  const listId = useId();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const add = (raw: string) => {
    const hint = onHint ?? (() => undefined);
    let path: string;
    try {
      path = normalizeTagPath(raw);
    } catch (error) {
      hint(error instanceof Error ? error.message : copy.tagInvalid);
      return;
    }
    setDraft("");
    if (!path) return;
    if (value.includes(path)) {
      hint(copy.tagExists);
      return;
    }
    if (value.length >= MAX_TAGS) {
      hint(copy.tagLimit(MAX_TAGS));
      return;
    }
    hint("");
    onChange([...value, path]);
  };

  const suggest = () => {
    if (busy || disabled) return;
    setBusy(true);
    void (async () => {
      try {
        const response = await aiSuggestTags({
          mode: "item",
          targets: [{ id: "current", text: suggestText.trim() || "新事项" }],
          candidates: options.slice(0, 200).map((tag) => ({ key: tag, label: tag })),
        });
        const created = response.created ?? [];
        for (const tag of created) {
          await createTagDefinition(tag).catch(() => undefined);
        }
        const next = [...value];
        for (const tag of response.suggestions[0]?.tags ?? []) {
          if (!next.includes(tag)) next.push(tag);
        }
        if (next.length === value.length) {
          onHint?.(copy.tagAiNone);
          return;
        }
        onChange(next.slice(0, MAX_TAGS));
        onHint?.(created.length > 0 ? copy.tagAiCreated(created.join("、")) : "");
      } catch (error) {
        onHint?.(error instanceof Error ? error.message : copy.tagAiNone);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="at-item-tag-field">
      <span className="at-item-tag-label">{copy.tagsLabel}</span>
      {value.map((tag) => (
        <button
          key={tag}
          type="button"
          className="at-item-tag-chip"
          title={copy.tagRemove(tag)}
          aria-label={copy.tagRemove(tag)}
          disabled={disabled}
          onClick={() => onChange(value.filter((item) => item !== tag))}
        >
          #{tag}
          <span aria-hidden> ×</span>
        </button>
      ))}
      <input
        className="at-input at-item-tag-input"
        type="text"
        list={listId}
        placeholder={copy.tagsPlaceholder}
        aria-label={copy.tagsLabel}
        value={draft}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "," || event.key === "，") {
            event.preventDefault();
            add(draft);
          } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
      />
      <datalist id={listId}>
        {options.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <button
        type="button"
        className="at-link-btn at-item-tag-ai"
        disabled={disabled || busy}
        onClick={suggest}
      >
        {busy ? copy.tagBusy : copy.tagAi}
      </button>
    </div>
  );
}
