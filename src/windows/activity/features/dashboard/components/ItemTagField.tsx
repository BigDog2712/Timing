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
import {
  listTimingItemTags,
  listTimingItems,
} from "../../../platform/persistence/timingReadRepository.ts";
import { itemMemoryEntries, pickExamples, resolveLocally } from "../../data/services/aiMemory.ts";
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
        const text = suggestText.trim() || "新事项";
        /* 单条入口没有现成的历史表，临时读一次（两条都是本地 SQLite 读，毫秒级）。
           读失败就当没有历史 —— 记不住比拦住"建议"更可接受。 */
        const [tagRows, items] = await Promise.all([
          listTimingItemTags().catch(() => []),
          listTimingItems().catch(() => []),
        ]);
        const tagsByItem = new Map(tagRows.map((row) => [row.itemId, row.tags]));
        const entries = itemMemoryEntries(items, tagsByItem);

        /* ── 先问记忆，再问模型（0.12.9）────────────────────────────────────
           新建事项时 `value` 通常为空，记忆里有同名/极相似的历史就直接用：0 延迟、
           不花钱，而且那是**用户自己**的口径，比模型重新猜更可能对。
           已有标签时不短路（交回模型重判）—— 这条约束在 `resolveLocally` 里。 */
        const local = resolveLocally([{ id: "current", text, existing: [...value] }], entries);
        const hit = local.hints[0];
        if (hit) {
          const next = [...value];
          for (const tag of hit.tags) if (!next.includes(tag)) next.push(tag);
          if (next.length === value.length) {
            onHint?.(copy.tagAiNone);
            return;
          }
          onChange(next.slice(0, MAX_TAGS));
          onHint?.(copy.tagAiMemory(hit.tags.join("、")));
          return;
        }

        const response = await aiSuggestTags({
          mode: "item",
          targets: [{ id: "current", text, existing: [...value] }],
          candidates: options.slice(0, 200).map((tag) => ({ key: tag, label: tag })),
          /* 已有 value 也当例子会重复（它已经是 target 的 existing）；
             历史里与这句名字最像的几条才是模型缺的那部分。 */
          examples: pickExamples([text], entries),
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
