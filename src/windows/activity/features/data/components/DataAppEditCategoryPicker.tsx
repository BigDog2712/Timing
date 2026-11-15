import type { CSSProperties } from "react";

import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { AppEditCategoryOption } from "../hooks/useAppEditDialog.ts";
import type { AppEditDraft } from "../services/appEditDraft.ts";

/**
 * 「分类」多选区（应用设置弹窗的第一段）。
 *
 * 三件事必须一眼看出来，否则这个多选就没法用：
 *   · 哪些勾了（原生 checkbox + `data-checked` 让整行有反馈，不只靠那个 13px 的方块）；
 *   · **哪个是主分类**（角标「主」；主分类 = 集合首项 = 写回的 `category`）；
 *   · 怎么换主分类（非主分类的勾选行上给一颗「设为主分类」）。
 *
 * 为什么不把 `other` 列进来：`other` 在本仓的语义是**未分类**（`normalizeCategorySet`
 * 与 `buildQuickAppOverride` 都会把它丢掉）。把它画成可勾选项，用户勾了却存不进去，
 * 是那种"点了没反应"的最坏形态。未分类的状态由"一个都没勾"表达，文案在区标题里说清。
 */
interface Props {
  options: readonly AppEditCategoryOption[];
  draft: AppEditDraft;
  disabled: boolean;
  labels: {
    title: string;
    hint: string;
    primaryBadge: string;
    setPrimary: string;
  };
  onToggle: (category: UserAssignableAppCategory) => void;
  onPromote: (category: UserAssignableAppCategory) => void;
}

export default function DataAppEditCategoryPicker({
  options,
  draft,
  disabled,
  labels,
  onToggle,
  onPromote,
}: Props) {
  const selectable = options.filter((option) => option.value !== "other");
  return (
    <section className="at-app-edit-section" aria-label={labels.title}>
      <h4 className="at-app-edit-section-title">{labels.title}</h4>
      <p className="at-app-edit-hint">{labels.hint}</p>
      {/* 内置 10 个（11 减去 other）恒在，`selectable` 不可能为空 —— 不留空态分支 */}
      <ul className="at-app-edit-picker">
        {selectable.map((option) => {
          const checked = draft.categories.includes(option.value);
          const primary = checked && draft.categories[0] === option.value;
          return (
            <li
              key={option.value}
              className="at-app-edit-option"
              data-checked={checked ? "" : undefined}
              data-primary={primary ? "" : undefined}
              data-category={option.value}
            >
              <label className="at-app-edit-option-label">
                <input
                  type="checkbox"
                  className="at-app-edit-check"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(option.value)}
                />
                <span
                  className="at-app-edit-swatch"
                  aria-hidden="true"
                  style={option.color
                    ? ({ "--at-app-edit-swatch": option.color } as unknown as CSSProperties)
                    : undefined}
                />
                <span className="at-app-edit-option-name">{option.label}</span>
              </label>
              {primary ? <span className="at-app-edit-badge">{labels.primaryBadge}</span> : null}
              {checked && !primary ? (
                <button
                  type="button"
                  className="at-link-btn at-app-edit-row-action"
                  disabled={disabled}
                  onClick={() => onPromote(option.value)}
                >
                  {labels.setPrimary}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
