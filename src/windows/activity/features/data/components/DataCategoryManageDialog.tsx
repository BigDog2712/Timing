import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { APP_EDIT_COPY } from "../appEditCopy.ts";
import { useCategoryAdminSession } from "../hooks/useCategoryAdminSession.ts";
import DataCategoryManagePanel from "./DataCategoryManagePanel.tsx";

/**
 * 独立打开的「分类管理」弹窗（数据页 → 分类 tab →「管理分类」/ 双击分类行）。
 *
 * ## [本轮] 全站唯一的分类管理入口
 *
 * 它原来只是「应用设置」弹窗第三段的第二扇门；现在应用设置里那段摘掉了，分类的增删改
 * **只有这一个地方**能做。理由：那是"一处配置"，不该塞进"给某个应用挑分类"的弹层里。
 *
 * ## 删除的影响面
 *
 * 每行右侧的「N 个在用」就是影响面；删除确认框里还会再写一遍「该分类下的应用会回到「未分类」」
 * 和同一份用量读数。**内置分类也能删**（只是从可选项里移除，历史记录一条不动），
 * 唯一不能删的是 `other` ——它是所有回落的目标。删掉的内置分类在最下面一行可以恢复。
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
      surfaceClassName="at-app-edit-dialog at-category-manage-dialog"
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
      {state.error ? <p className="at-app-edit-issue" role="status">{state.error}</p> : null}
      {state.loading ? (
        <p className="at-app-edit-hint" role="status">{UI_TEXT.common.loading}</p>
      ) : (
        <>
          <p className="at-app-edit-hint">{copy.manageHint}</p>
          <DataCategoryManagePanel
            options={state.options}
            usage={state.usage}
            deletedOptions={state.deletedOptions}
            disabled={state.managing}
            managing={state.managing}
            labels={{
              title: copy.manage,
              usage: copy.usageCount,
              createColorHint: copy.createColorHint,
              deletedHint: copy.deletedHint,
            }}
            onCreate={(label, color) => { void state.createCategory(label, color); }}
            onRename={state.renameCategory}
            onDelete={(category) => { void state.deleteCategory(category); }}
            onRestore={(category) => { void state.restoreCategory(category); }}
            /* `null` = 恢复默认色（写 `value: null` = 删掉覆盖），不能当"没选色"过滤掉 */
            onApplyColor={(category, color) => { void state.recolorCategory(category, color); }}
            dialogsElement={state.dialogsElement}
          />
        </>
      )}
    </QuietDialog>
  );
}
