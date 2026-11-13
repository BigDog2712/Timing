import { useState } from "react";
import { PencilLine, Plus, Trash2 } from "lucide-react";

import { isExtendedCategory, type AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietColorField from "../../../shared/components/QuietColorField.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting.ts";
import type { AppEditCategoryOption } from "../hooks/useAppEditDialog.ts";

/**
 * 「分类管理」区（应用设置弹窗的第三段）：增 / 删 / 改 / 查 四件事的入口。
 *
 * ## 为什么不用现成的 `CategoryColorControls`
 *
 * 那个组件画的是"色块 + 名字 + 改名 + 删除"，正合适——但它**没有地方放用量**，
 * 而且对内置分类也画删除键。本区要的两件事恰好是它没有的：
 *   · **查**：每行显示"多少个应用/域名正指着它"（删除影响面）；
 *   · **删只给自定义分类**：内置 11 类可以隐藏（`deletedCategories`）但**定义不能删**，
 *     `other` 更是所有回落的目标（`buildCategoryMemberFallbackMutations` 的注释）。
 * 所以这里自己排行，但**复用同一批原子件**（`QuietColorField` 取色、
 * `QuietIconAction` 图标键、`qp-category-management-grid` 那套版式类），
 * 外观与映射页的分类面板一致，不新造一套视觉。
 *
 * 改名不在这里做：它要弹 `QuickClassificationRenameDialog`（可复用的既有弹窗），
 * 而弹窗该由**弹窗层**持有，不能从一段内容里再开一层。所以这里只发一个请求给上层。
 */
interface Props {
  options: readonly AppEditCategoryOption[];
  usage: Readonly<Record<string, number>>;
  disabled: boolean;
  labels: {
    title: string;
    usage: (count: number) => string;
  };
  onRequestRename: (category: AppCategory, label: string) => void;
  onDelete: (category: AppCategory) => void;
  onApplyColor: (category: AppCategory, color: string | null) => void;
  onCreate: () => void;
}

export default function DataAppEditCategoryManager({
  options,
  usage,
  disabled,
  labels,
  onRequestRename,
  onDelete,
  onApplyColor,
  onCreate,
}: Props) {
  const UI_TEXT = useLocaleText();
  const [colorFormat, setColorFormat] = useState<ColorDisplayFormat>("hex");

  return (
    <section className="qp-app-edit-section" aria-label={labels.title}>
      <div className="qp-app-edit-section-head">
        <h4 className="qp-app-edit-section-title">{labels.title}</h4>
        <button
          type="button"
          className="qp-link-btn qp-app-edit-row-action"
          disabled={disabled}
          onClick={onCreate}
        >
          <Plus size={12} aria-hidden="true" /> {UI_TEXT.mapping.createCategoryAction}
        </button>
      </div>
      <div className="qp-category-management-grid">
        {options.map((option) => {
          const label = option.label;
          return (
            <div
              key={option.value}
              className="rounded-[10px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] px-3 py-2.5"
              data-category={option.value}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                  <QuietColorField
                    color={option.color}
                    format={colorFormat}
                    presentation="swatch"
                    onChange={(nextColor) => onApplyColor(option.value, nextColor)}
                    onFormatChange={setColorFormat}
                    title={UI_TEXT.mapping.color}
                    disabled={disabled}
                    resetAction={{
                      label: UI_TEXT.mapping.restoreDefaultColor,
                      onReset: () => onApplyColor(option.value, null),
                    }}
                  />
                  <span className="min-w-0 truncate qp-text-body qp-weight-medium text-[var(--qp-text-primary)]">
                    {label}
                  </span>
                  <QuietIconAction
                    icon={<PencilLine size={13} />}
                    className="qp-icon-action-dimmed"
                    disabled={disabled}
                    onClick={() => onRequestRename(option.value, label)}
                    title={UI_TEXT.mapping.renameCategory(label)}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* 查：用量读数是删除前的唯一判据，所以放在删除键旁边 */}
                  <span className="qp-app-edit-usage">{labels.usage(usage[option.value] ?? 0)}</span>
                  {/* 删：只有自定义分类（`custom:` 前缀）才有这颗键 */}
                  {isExtendedCategory(option.value) ? (
                    <QuietIconAction
                      icon={<Trash2 size={12} />}
                      tone="danger"
                      disabled={disabled}
                      onClick={() => onDelete(option.value)}
                      title={UI_TEXT.mapping.deleteCategory(label)}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
