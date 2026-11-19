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
import { useState } from 'react';

import { aiApi, tagApi } from '../../services/api';
import { normalizeTagPath } from '../../../shared/tags/normalize';

const MAX_TAGS = 8;

interface PanelTagFieldProps {
  value: string[];
  /** 候选（已有标签的并集） */
  options: string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
  onHint: (message: string) => void;
}

export function PanelTagField({ value, options, disabled, onChange, onHint }: PanelTagFieldProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

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
        const response = await aiApi.suggestTags({
          mode: 'item',
          targets: [{ id: 'current', text: draft.trim() || '新事项' }],
          candidates: options.slice(0, 200).map((tag) => ({ key: tag, label: tag })),
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
        list="panel-tag-options"
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
      <datalist id="panel-tag-options">
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
