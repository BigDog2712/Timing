import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { APP_EDIT_COPY } from "../appEditCopy.ts";
import { useCategoryAdminSession } from "../hooks/useCategoryAdminSession.ts";
import DataCategoryManagePanel from "./DataCategoryManagePanel.tsx";

/**
 * 独立打开的「分类管理」弹窗（数据页 → 分类 tab →「管理分类」/ 双击分类行）。
 *
 * ## 为什么这件事原来没有门
 *
 * 分类的增删改查早就实现了，但只长在「应用设置」弹窗（双击应用趋势的一行）里：
 * 想删一个自己建错的分类，得先去应用 tab 找一个"恰好属于它"的应用、双击它、再往下滚。
 * 分类 tab 上明明列着全部分类，却对它们什么都做不了 —— 这就是用户提的那条。
 *
 * ## 复用而不是复制
 *
 * 内容整段是 `DataCategoryManagePanel`（和应用设置弹窗里的第三段是**同一个组件**），
 * 所以两处永远长得一样、走同一套写路径（`useAppEditCategoryAdmin` →
 * `commitClassificationSettingMutations`），不存在"这里能删、那里删不掉"的分叉。
 *
 * ## 删除的影响面
 *
 * 每行右侧的「N 个在用」就是影响面；删除确认框里还会再写一遍「该分类下的应用会回到「其他」」
 * 和同一份用量读数。内置 11 类**没有删除键**（`isExtendedCategory` 为假），`other` 尤其不能删
 * ——它是所有回落的目标。
 */
export default function DataCategoryManageDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** 任何一次写成功之后通知页面重取数（趋势图按分类着色 / 排行会变） */
  onChanged?: () => void;
}) {
  /* `open === false` 时**不挂载**内层：分类会话（那份 bootstrap 与用例）随卸载一起丢弃，
     下次打开不会带着上一次的错误提示与悬浮状态 */
  if (!open) return null;
  return <DataCategoryManageDialogSurface onClose={onClose} onChanged={onChanged} />;
}

function DataCategoryManageDialogSurface({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: () => void;
}) {
  const UI_TEXT = useLocaleText();
  const copy = APP_EDIT_COPY[useLocale()];
  const state = useCategoryAdminSession({ onChanged });

  return (
    <QuietDialog
      open
      title={copy.manageAction}
      surfaceClassName="qp-app-edit-dialog qp-category-manage-dialog"
      onClose={() => {
        /* 写库中途不许关：关闭会卸载会话，正在飞的那次提交就没人收尾了 */
        if (!state.managing) onClose();
      }}
      actions={(
        <QuietButton tone="secondary" onClick={onClose} disabled={state.managing}>
          {UI_TEXT.common.close}
        </QuietButton>
      )}
    >
      {state.error ? <p className="qp-app-edit-issue" role="status">{state.error}</p> : null}
      {state.loading ? (
        <p className="qp-app-edit-hint" role="status">{UI_TEXT.common.loading}</p>
      ) : (
        <>
          <p className="qp-app-edit-hint">{copy.manageHint}</p>
          <DataCategoryManagePanel
            options={state.options}
            usage={state.usage}
            disabled={state.managing}
            managing={state.managing}
            labels={{ title: copy.manage, usage: copy.usageCount, createColorHint: copy.createColorHint }}
            onCreate={(label, color) => { void state.createCategory(label, color); }}
            onRename={state.renameCategory}
            onDelete={(category) => { void state.deleteCategory(category); }}
            /* `null` = 恢复默认色（写 `value: null` = 删掉覆盖），不能当"没选色"过滤掉 */
            onApplyColor={(category, color) => { void state.recolorCategory(category, color); }}
            dialogsElement={state.dialogsElement}
          />
        </>
      )}
    </QuietDialog>
  );
}
