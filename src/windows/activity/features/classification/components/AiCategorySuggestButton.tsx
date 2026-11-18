/**
 * 应用分类 · AI 批量建议（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 只做「提议」：把当前列表里的应用发给模型，拿回分类后先弹窗给用户看一遍，确认才交给
 * 页面的 `handleCategoryAssign`。**不直接写库**——分类是活动统计的口径，误改比多点一次贵。
 *
 * 候选表就是页面上已有的分类选项（`{key: 分类值, label: 显示名}`），提示词要求模型只从
 * 里面挑；后端还会按 key/label 校验一次，编出来的值在那一步被丢掉。
 */
import { Sparkles } from "lucide-react";
import { useState } from "react";

import QuietButton from "../../../shared/components/QuietButton";
import QuietDialog from "../../../shared/components/QuietDialog";
import type { AiTagCandidate, AiTagTarget } from "../../../shared/types/ai.ts";
import { aiSuggestTags } from "../../../platform/desktop/hostAiGateway.ts";

interface Assignment {
  id: string;
  text: string;
  categories: string[];
}

interface Props {
  apps: AiTagTarget[];
  categories: AiTagCandidate[];
  onApply: (assignments: Array<{ id: string; categories: string[] }>) => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function AiCategorySuggestButton({ apps, categories, onApply }: Props) {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const labels = new Map(categories.map((category) => [category.key, category.label]));
  const names = new Map(apps.map((app) => [app.id, app.text]));

  const suggest = () => {
    if (busy || apps.length === 0) return;
    setBusy(true);
    setError(null);
    void aiSuggestTags({ mode: "app", targets: apps, candidates: categories })
      .then((response) => {
        const suggestions = response.suggestions;
        const next: Assignment[] = [];
        for (const suggestion of suggestions) {
          const nextCategories = suggestion.tags.filter((tag) => labels.has(tag));
          if (nextCategories.length === 0 || next.some((row) => row.id === suggestion.id)) continue;
          next.push({
            id: suggestion.id,
            text: names.get(suggestion.id) ?? suggestion.id,
            categories: nextCategories,
          });
        }
        setRows(next);
        if (next.length === 0) setError("AI 没有给出可用的分类建议");
        else if (response.stats.failedBatches) {
          setError(`部分建议生成失败（${response.stats.failedBatches}/${response.stats.batches ?? "?"} 批），已保留成功结果`);
        }
      })
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(false));
  };

  const toggleCategory = (id: string, category: string) => {
    setRows((current) => current?.map((row) => {
      if (row.id !== id) return row;
      const categories = row.categories.includes(category)
        ? row.categories.filter((value) => value !== category)
        : [...row.categories, category];
      return { ...row, categories };
    }).filter((row) => row.categories.length > 0) ?? null);
  };

  const apply = () => {
    if (rows && rows.length > 0) {
      onApply(rows.map((row) => ({ id: row.id, categories: row.categories })));
    }
    setRows(null);
  };

  return (
    <>
      <QuietButton size="large" busy={busy} onClick={suggest} className="rounded-[8px]">
        <Sparkles size={14} aria-hidden />
        AI 建议
      </QuietButton>
      {error ? <span role="alert" aria-live="assertive" className="max-w-[220px] truncate at-text-caption text-[var(--at-danger)]" title={error}>{error}</span> : null}
      <QuietDialog
        open={rows !== null}
        title="AI 分类建议"
        description="确认后写入草稿；记得再点页面上的「保存」。"
        onClose={() => setRows(null)}
        actions={(
          <>
            <QuietButton onClick={() => setRows(null)}>取消</QuietButton>
            <QuietButton tone="primary" onClick={apply}>应用建议</QuietButton>
          </>
        )}
      >
        <ul className="flex max-h-72 flex-col gap-2 overflow-auto">
          {(rows ?? []).map((row) => (
            <li key={row.id} className="flex flex-col gap-1 at-text-caption">
              <span className="truncate text-[var(--at-text-secondary)]">{row.text}</span>
              <div className="flex flex-wrap gap-1">
                {categories.map((category) => (
                  <label key={category.key} className="inline-flex items-center gap-1 text-[var(--at-text-primary)]">
                    <input
                      type="checkbox"
                      checked={row.categories.includes(category.key)}
                      onChange={() => toggleCategory(row.id, category.key)}
                    />
                    {category.label}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </QuietDialog>
    </>
  );
}