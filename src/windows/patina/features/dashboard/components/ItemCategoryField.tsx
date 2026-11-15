/**
 * 「事项分类」一个下拉（[0.13] 新建事项 / 常用事项共用）。
 *
 * 只管展示与选择：候选从 `useItemCategoryOptions` 来，写动作经 `onChange` 交回容器
 * （意图没有回执，"发出去没有"只有容器知道，照 `ItemEditForm` 的同一条纪律）。
 *
 * 两处消费者各自的形态差别由 props 承担：
 *   · 新建弹层：带「管理分类」入口（`onManage`），用户可以在建的时候顺手加一个分类；
 *   · 事项管理行：只留下拉（管理员入口在弹层底部一处，行内不再重复一颗键）。
 *
 * 「未分类」用空串作 `QuietSelect` 的哨兵值（它只接受 `string | number` 的 value，
 * `undefined` 在受控组件里会退化成"未选中"的两种表示法）；出口处再翻回 `null`，
 * 因为意图层的三态语义是 `null` 而不是空串。
 */
import QuietSelect from "../../../shared/components/QuietSelect.tsx";
import { withCurrentValueOption } from "../../../../shared/classification/categoryCatalog.ts";
import type { ItemCategoryOption } from "../hooks/useItemCategoryOptions.ts";

interface Props {
  value: string | null;
  options: readonly ItemCategoryOption[];
  noneLabel: string;
  ariaLabel: string;
  disabled: boolean;
  /** 不传就不渲染「管理分类」入口（事项管理行用不到第二颗） */
  manageAction?: { label: string; onManage: () => void };
  onChange: (next: string | null) => void;
}

export default function ItemCategoryField({
  value,
  options,
  noneLabel,
  ariaLabel,
  disabled,
  manageAction,
  onChange,
}: Props) {
  /* [0.14] selectedOption 兜底：当前值非空且不在候选时追加原键名一项。
     `.qp-select-label` 默认 hidden、仅当前项可见（quiet-select.css），兜底缺位时
     触发器整块空白 —— 修在消费侧（共享 `withCurrentValueOption`），不动 QuietSelect 本体。 */
  const selectOptions = [
    { value: "", label: noneLabel },
    ...withCurrentValueOption(options, value ?? "").map((option) => ({
      value: option.value,
      label: option.label,
    })),
  ];

  return (
    <span className="qp-item-category">
      <QuietSelect
        value={value ?? ""}
        options={selectOptions}
        onChange={(next) => onChange(next === "" ? null : next)}
        ariaLabel={ariaLabel}
        density="compact"
        disabled={disabled}
        className="qp-item-category-select"
      />
      {manageAction ? (
        <button
          type="button"
          className="qp-link-btn qp-timeline-item-action"
          disabled={disabled}
          onClick={manageAction.onManage}
        >
          {manageAction.label}
        </button>
      ) : null}
    </span>
  );
}
