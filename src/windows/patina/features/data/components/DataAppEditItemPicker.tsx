import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import QuietSelect from "../../../shared/components/QuietSelect.tsx";
import type { AppEditCategoryOption } from "../hooks/useAppEditDialog.ts";
import type { AppEditDraft } from "../services/appEditDraft.ts";

/**
 * 「绑定事项」多选区（应用设置弹窗的第二段）。
 *
 * 一个应用可以绑多个事项，每个事项可以指定"它归属哪个分类"；不指定 = 跟随主分类。
 * 为什么归属分类的候选**只**取该应用已勾选的分类：让用户能把事项归到一个"这个应用
 * 根本不属于的分类"，界面上说得通（都是用户的分类），但统计口径会立刻变得无法解释
 * —— 一个应用的行上写着 A 分类，它的事项却记在 B 分类里。所以候选 = 已勾选集合。
 *
 * 事项清单读不到时**只降级这一栏**（`itemsLoadFailed`）：分类多选、分类管理、
 * 保存全都照旧可用 —— 与快捷分类弹层里那一栏同一口径。
 *
 * 「跟随主分类」用空串作 `QuietSelect` 的哨兵值（它只接受 `string | number` 的 value，
 * 而 `undefined` 在受控组件里会退化成"未选中"的两种表示法）。
 */
interface Props {
  items: readonly { id: number; name: string; color?: string }[];
  draft: AppEditDraft;
  /** 该应用已勾选的分类（顺序即主分类优先） */
  checkedCategories: readonly AppEditCategoryOption[];
  disabled: boolean;
  loadFailed: boolean;
  labels: {
    title: string;
    hint: string;
    empty: string;
    loadFailed: string;
    followPrimary: string;
  };
  onToggle: (itemId: number) => void;
  onAssign: (itemId: number, category: UserAssignableAppCategory | undefined) => void;
}

export default function DataAppEditItemPicker({
  items,
  draft,
  checkedCategories,
  disabled,
  loadFailed,
  labels,
  onToggle,
  onAssign,
}: Props) {
  const categorySelectOptions = [
    { value: "", label: labels.followPrimary },
    ...checkedCategories.map((option) => ({ value: option.value as string, label: option.label })),
  ];

  return (
    <section className="qp-app-edit-section" aria-label={labels.title}>
      <h4 className="qp-app-edit-section-title">{labels.title}</h4>
      {loadFailed ? (
        <p className="qp-app-edit-hint" role="status">{labels.loadFailed}</p>
      ) : items.length === 0 ? (
        <p className="qp-app-edit-hint">{labels.empty}</p>
      ) : (
        <>
          <p className="qp-app-edit-hint">{labels.hint}</p>
          <ul className="qp-app-edit-picker qp-app-edit-picker-items">
            {items.map((item) => {
              const binding = draft.itemBindings.find((entry) => entry.itemId === item.id);
              const bound = binding !== undefined;
              return (
                <li
                  key={item.id}
                  className="qp-app-edit-option qp-app-edit-item"
                  data-checked={bound ? "" : undefined}
                  data-item-id={item.id}
                >
                  <label className="qp-app-edit-option-label">
                    <input
                      type="checkbox"
                      className="qp-app-edit-check"
                      checked={bound}
                      disabled={disabled}
                      onChange={() => onToggle(item.id)}
                    />
                    <span className="qp-app-edit-option-name" title={item.name}>{item.name}</span>
                  </label>
                  {bound ? (
                    <QuietSelect
                      value={(binding.category ?? "") as string}
                      options={categorySelectOptions}
                      onChange={(value) => onAssign(
                        item.id,
                        value === "" ? undefined : value as UserAssignableAppCategory,
                      )}
                      ariaLabel={`${item.name} · ${labels.followPrimary}`}
                      density="compact"
                      disabled={disabled || checkedCategories.length === 0}
                      className="qp-app-edit-item-category"
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
