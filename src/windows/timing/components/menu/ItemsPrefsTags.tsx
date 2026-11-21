/**
 * Timing — 事项标签编辑（[0.12.3]）
 * -----------------------------------------------------------------------------
 * Obsidian 风格的标签路径：`#学习/考公`、`#娱乐`。输入框回车 / 逗号添加，
 * 退格在空输入时删最后一个；`datalist` 只给已有标签（[0.12.4] 起分类不再是候选来源）。
 *
 * 「AI 建议」只做**填进编辑区**，不直接落库：用户仍要在保存时确认一次。
 * AI 调用失败走 `onError`（管理卡统一的红字条），空建议给本组件的浅色提示。
 */
import { useState } from 'react';

import { aiApi, itemApi, tagApi } from '../../services/api';
import { itemMemoryEntries, resolveLocally } from '../../services/aiMemory';
import type { AiTagCandidate } from '../../types/domain/ai';

interface ItemsPrefsTagsProps {
  itemName: string;
  value: string[];
  /** 已有标签（datalist 候选，去重后由容器给；不含分类 —— 那条目录已不是用户面概念） */
  suggestions: string[];
  /** AI 候选（key 与 label 都是标签路径） */
  candidates: AiTagCandidate[];
  disabled: boolean;
  onChange: (tags: string[]) => void;
  onError: (err: unknown) => void;
}

const MAX_TAGS = 12;

function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .slice(0, 64);
}

export function ItemsPrefsTags({
  itemName,
  value,
  suggestions,
  candidates,
  disabled,
  onChange,
  onError,
}: ItemsPrefsTagsProps) {
  const [draft, setDraft] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [hint, setHint] = useState('');

  const add = () => {
    const tag = normalizeTag(draft);
    setDraft('');
    if (!tag) return;
    if (value.includes(tag)) {
      setHint('这个标签已经有了');
      return;
    }
    if (value.length >= MAX_TAGS) {
      setHint(`最多 ${MAX_TAGS} 个标签`);
      return;
    }
    setHint('');
    onChange([...value, tag]);
  };

  const remove = (tag: string) => onChange(value.filter((item) => item !== tag));

  const suggest = () => {
    if (aiBusy || disabled) return;
    setAiBusy(true);
    setHint('');
    void (async () => {
      try {
        const text = itemName.trim() || '未命名事项';

        /* ── 先问记忆（0.12.9）──────────────────────────────────────────────
           只在**这条还没有标签**时试：已有标签说明用户点的是"重判"，那是模型的活
           （`resolveLocally` 对非空 existing 一律返回 pending）。
           命中就 0 延迟给答案、不花 token；没命中才走下面的请求。 */
        if (value.length === 0) {
          const [tagRows, items] = await Promise.all([
            tagApi.list().catch(() => []),
            itemApi.list().catch(() => []),
          ]);
          const tagsByItem = new Map(tagRows.map((row) => [row.itemId, row.tags]));
          const local = resolveLocally(
            [{ id: 'current', text, existing: [] }],
            itemMemoryEntries(items, tagsByItem),
          );
          const hit = local.hints[0];
          if (hit) {
            onChange(hit.tags.slice(0, MAX_TAGS));
            setHint(`按记忆填入 ${hit.tags.join('、')}（没调用模型）`);
            return;
          }
        }

        const rows = await aiApi.suggestTags({
          mode: 'item',
          /* `existing` 是这条事项**当前**的标签：带上它，模型才不会把用户刚选的
             `工作/周报` 换成它自己造的近义词（"重新判断"必须有依据）。 */
          targets: [{ id: 'current', text, existing: [...value] }],
          candidates: candidates.slice(0, 200),
        });
        const next = [...value];
        for (const tag of rows.suggestions[0]?.tags ?? []) {
          if (!next.includes(tag)) next.push(tag);
        }
        if (next.length === value.length) {
          setHint(rows.suggestions.length === 0 ? 'AI 没有给出建议' : '建议的标签已经都在了');
        } else {
          onChange(next.slice(0, MAX_TAGS));
        }
      } catch (err) {
        onError(err);
      } finally {
        setAiBusy(false);
      }
    })();
  };

  return (
    <div className="items-prefs__tags">
      <div className="items-prefs__tags-head">
        <label htmlFor="items-prefs-tag-input">标签</label>
        <button
          type="button"
          className="items-prefs__ai"
          disabled={disabled || aiBusy}
          onClick={suggest}
        >
          {aiBusy ? '建议中…' : 'AI 建议'}
        </button>
      </div>
      {value.length > 0 && (
        <div className="items-prefs__tag-chips">
          {value.map((tag) => (
            <button
              key={tag}
              type="button"
              className="items-prefs__tag-chip"
              disabled={disabled}
              title={`移除 #${tag}`}
              aria-label={`移除标签 #${tag}`}
              onClick={() => remove(tag)}
            >
              #{tag}
              <span aria-hidden> ×</span>
            </button>
          ))}
        </div>
      )}
      <input
        id="items-prefs-tag-input"
        type="text"
        className="common-items__input"
        list="items-prefs-tag-options"
        placeholder="回车添加，如 学习/考公"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
            event.preventDefault();
            add();
          } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
      />
      <datalist id="items-prefs-tag-options">
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      {hint && <p className="items-prefs__tag-hint">{hint}</p>}
    </div>
  );
}