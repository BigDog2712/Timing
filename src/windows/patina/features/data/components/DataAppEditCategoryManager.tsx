import { useState } from "react";
import { PencilLine, Plus, Trash2 } from "lucide-react";

import { isExtendedCategory, type AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietColorField from "../../../shared/components/QuietColorField.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting.ts";
import type { AppEditCategoryOption } from "../hooks/useAppEditDialog.ts";

/**
 * 「分类管理」区：增 / 删 / 改 / 查 四件事的入口。
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
 * ## [本轮] 「新建」从 `prompt` 换成一行表单：名字与颜色一起收
 *
 * 原来的「新建分类」弹 `useQuietDialogs.prompt` —— 它只能收一行文字，分类颜色没有地方选，
 * 用户建完还得再找到那一行去点色块。现在这一行表单里名字与色块并排，一次提交写
 * **定义 + 标签**（**只有用户动过色块时**才多写一条颜色覆盖，见下一段；编排在
 * `useAppEditCategoryAdmin.createCategory` 的注释）。
 *
 * ## [本轮] 新建：**用户没选色就不写颜色覆盖**
 *
 * 色块上那个灰只画出来给人看，**不是**用户的决定。判据就一条 —— 用户动过色块没有：
 *   · 没动（`draftColor === null`）→ `onCreate(label, null)`，一条颜色覆盖都不写，
 *     分类交给调色板自动取色（`ProcessMapper.getDefaultCategoryColor`）。这与
 *     「恢复默认色」是同一个口径（`value: null` = 没有覆盖），也是上一轮清掉的
 *     "D-3 僵尸记录"同类：用户从没选过的值不该被记成他的选择。
 *   · 动过 → 才写覆盖。
 * 所以"未选"状态必须**看得出来**：色块下面一行小字 + 色块的 tooltip 一起说明
 * 「不选色则按调色板自动取色」，选过之后小字消失、tooltip 回到「颜色」，
 * 并且色块弹层里多一颗「恢复默认色」把状态退回未选（这与每行的色块同一套语义）。
 *
 * 改名不在这里做：它要弹 `QuickClassificationRenameDialog`（可复用的既有弹窗），
 * 而弹窗该由**弹窗层**持有，不能从一段内容里再开一层。所以这里只发一个请求给上层。
 */
/**
 * 新建行色块在「未选」状态下画的那个**预览**色（中性灰）。
 *
 * 只用于渲染：`QuietColorField` 的 `color` 是必填 `string`（空串会被 `hexToRgb` 解析成黑，
 * 用户以为分类是黑的），所以未选时得有个东西画在色块里。它**从不进入任何 mutation** ——
 * 提交时传的是 `null`，见文件头「用户没选色就不写颜色覆盖」。
 */
const NEW_CATEGORY_UNSET_PREVIEW_COLOR = "#8A8F99";

interface Props {
  options: readonly AppEditCategoryOption[];
  usage: Readonly<Record<string, number>>;
  disabled: boolean;
  labels: {
    title: string;
    usage: (count: number) => string;
    /** 未选色时的小字 + 色块 tooltip（「不选色则按调色板自动取色」） */
    createColorHint: string;
  };
  onRequestRename: (category: AppCategory, label: string) => void;
  onDelete: (category: AppCategory) => void;
  onApplyColor: (category: AppCategory, color: string | null) => void;
  /** 名字与颜色一起交出去；`color === null` = 用户没选色（**不写**颜色覆盖） */
  onCreate: (label: string, color: string | null) => void;
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
  const [draftLabel, setDraftLabel] = useState("");
  /* `null` = 用户还没碰过色块（不是"选了灰"）：提交出去的就是"不写覆盖" */
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const colorUnset = draftColor === null;
  const canCreate = !disabled && draftLabel.trim().length > 0;
  const submitCreate = () => {
    if (!canCreate) return;
    onCreate(draftLabel, draftColor);
    /* 提交后清空名字、色块回到"未选"：接着建下一个时不会带着上一个的名字或颜色 */
    setDraftLabel("");
    setDraftColor(null);
  };

  return (
    <section className="qp-app-edit-section" aria-label={labels.title}>
      <div className="qp-app-edit-section-head">
        <h4 className="qp-app-edit-section-title">{labels.title}</h4>
      </div>
      <div className="data-category-create-row">
        <input
          type="text"
          className="data-category-create-input"
          value={draftLabel}
          placeholder={UI_TEXT.mapping.createCategoryPlaceholder}
          aria-label={UI_TEXT.mapping.createCategoryTitle}
          disabled={disabled}
          onChange={(event) => setDraftLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submitCreate();
          }}
        />
        <QuietColorField
          color={draftColor ?? NEW_CATEGORY_UNSET_PREVIEW_COLOR}
          format={colorFormat}
          presentation="swatch"
          /* 未选时 tooltip 说的是"这只是预览"；选过之后才是普通「颜色」 */
          title={colorUnset ? labels.createColorHint : UI_TEXT.mapping.color}
          disabled={disabled}
          onChange={setDraftColor}
          onFormatChange={setColorFormat}
          /* 选过色才给「恢复默认色」：退回未选 = 又不写覆盖了 */
          resetAction={colorUnset ? undefined : {
            label: UI_TEXT.mapping.restoreDefaultColor,
            onReset: () => setDraftColor(null),
          }}
        />
        <button
          type="button"
          className="qp-link-btn qp-app-edit-row-action"
          disabled={!canCreate}
          onClick={submitCreate}
        >
          <Plus size={12} aria-hidden="true" /> {UI_TEXT.mapping.createCategoryAction}
        </button>
      </div>
      {/* 未选色的小字：没有它，色块里那个灰读起来就是"已经选好的灰" */}
      {colorUnset ? (
        <p className="qp-app-edit-hint data-category-create-hint">{labels.createColorHint}</p>
      ) : null}
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
