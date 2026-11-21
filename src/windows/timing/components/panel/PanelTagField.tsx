/**
 * Timing — 快捷添加面板的标签行（[0.12.4]）
 * -----------------------------------------------------------------------------
 * 「悬浮窗快捷添加事项时要能顺手填标签」：一行输入框 + 已选 chips + `datalist` 候选，
 * 回车 / 逗号确认，退格在空输入时删最后一个。候选来自**已有标签的并集**
 * （标签定义 + 所有事项上的路径），所以不用先跳去管理页建一遍。
 *
 * 「AI」按钮先匹配已有标签、匹配不到再按规则新建（一级只允许 生活 / 工作 / 学习 /
 * 娱乐 / 复盘，最多两级），新建的标签会在这里以 chip 形式出现，用户仍可删掉。
 * AI 失败只提示，不挡「保存」。
 */
import { useId, useState } from 'react';

import { aiApi, itemApi, tagApi } from '../../services/api';
import { itemMemoryEntries, pickExamples, resolveLocally } from '../../services/aiMemory';
import { normalizeTagPath } from '../../../shared/tags/normalize';

const MAX_TAGS = 8;

interface PanelTagFieldProps {
  value: string[];
  /** 候选（已有标签的并集） */
  options: string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
  onHint: (message: string) => void;
  /**
   * 喂给 AI 的事项文本。药丸快捷新建时名称在**条上**的输入框里（不归本组件管），
   * 不传就会把「新事项」这三个字拿去做建议 —— 与真实输入对不上。
   */
  suggestText?: string;
}

export function PanelTagField({ value, options, disabled, onChange, onHint, suggestText }: PanelTagFieldProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /* 每个实例一份：ItemPicker 与药丸快捷添加可能先后挂载，写死 id 会让两处 datalist 撞车 */
  const listId = useId();

  const add = (raw: string) => {
    let path: string;
    try {
      path = normalizeTagPath(raw);
    } catch (error) {
      onHint(error instanceof Error ? error.message : '标签不合法');
      return;
    }
    setDraft('');
    if (!path) return;
    if (value.includes(path)) {
      onHint('这个标签已经有了');
      return;
    }
    if (value.length >= MAX_TAGS) {
      onHint(`最多 ${MAX_TAGS} 个标签`);
      return;
    }
    onHint('');
    onChange([...value, path]);
  };

  const suggest = () => {
    if (busy || disabled) return;
    setBusy(true);
    onHint('');
    void (async () => {
      try {
        const text = suggestText?.trim() || draft.trim() || '新事项';
        /* 药丸侧没有现成的历史表：读一次事项与标签，把最像的几条当例子。
           两条都是本地 SQLite 读，读失败按"没有历史"处理，不挡建议。 */
        const [tagRows, items] = await Promise.all([
          tagApi.list().catch(() => []),
          itemApi.list().catch(() => []),
        ]);
        const tagsByItem = new Map(tagRows.map((row) => [row.itemId, row.tags]));
        const entries = itemMemoryEntries(items, tagsByItem);

        /* 先问记忆，再问模型：药丸快捷新建的事项多数是重复动作（"写周报"每周一次），
           记忆里有同名/极相似的历史就直接填，0 延迟不花钱，而且是用户自己的口径。
           已有标签时不短路（交回模型重判）—— 约束在 `resolveLocally` 里。 */
        const local = resolveLocally([{ id: 'current', text, existing: [...value] }], entries);
        const hit = local.hints[0];
        if (hit) {
          const next = [...value];
          for (const tag of hit.tags) if (!next.includes(tag)) next.push(tag);
          if (next.length === value.length) {
            onHint('AI 没有给出更合适的标签');
            return;
          }
          onChange(next.slice(0, MAX_TAGS));
          onHint(`按记忆填入 ${hit.tags.join('、')}（没调用模型）`);
          return;
        }

        const response = await aiApi.suggestTags({
          mode: 'item',
          targets: [{ id: 'current', text, existing: [...value] }],
          candidates: options.slice(0, 200).map((tag) => ({ key: tag, label: tag })),
          examples: pickExamples([text], entries),
        });
        const next = [...value];
        for (const tag of response.suggestions[0]?.tags ?? []) {
          if (!next.includes(tag)) next.push(tag);
        }
        if (next.length === value.length) {
          onHint('AI 没有给出更合适的标签');
          return;
        }
        const created = response.created ?? [];
        onChange(next.slice(0, MAX_TAGS));
        onHint(created.length > 0 ? `AI 新建了 ${created.join('、')}` : '');
      } catch (error) {
        onHint(error instanceof Error ? error.message : 'AI 建议失败');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="panel__tags">
      <span className="panel__tag-label">标签</span>
      {value.map((tag) => (
        <button
          key={tag}
          type="button"
          className="panel__tag-chip"
          title={`移除 #${tag}`}
          aria-label={`移除标签 #${tag}`}
          disabled={disabled}
          onClick={() => onChange(value.filter((item) => item !== tag))}
        >
          #{tag}
          <span aria-hidden> ×</span>
        </button>
      ))}
      <input
        className="panel__tag-input"
        type="text"
        list={listId}
        placeholder="回车添加，如 学习/考公"
        aria-label="事项标签"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
            event.preventDefault();
            add(draft);
          } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
      />
      <datalist id={listId}>
        {options.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <button type="button" className="panel__tag-ai" disabled={disabled || busy} onClick={suggest}>
        {busy ? '建议中…' : 'AI'}
      </button>
    </div>
  );
}

/** 已有标签的并集（定义 + 各事项上的路径），供快捷添加的候选与 AI 的候选表。 */
export async function loadTagOptions(): Promise<string[]> {
  const [catalog, assignments] = await Promise.all([tagApi.catalog(), tagApi.list()]);
  const all = new Set<string>(catalog);
  for (const row of assignments) for (const tag of row.tags) all.add(tag);
  return [...all].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}
