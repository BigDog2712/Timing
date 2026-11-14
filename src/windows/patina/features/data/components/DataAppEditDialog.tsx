import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { APP_EDIT_COPY } from "../appEditCopy.ts";
import { useAppEditDialog, type AppEditDialogTarget } from "../hooks/useAppEditDialog.ts";
import DataCategoryManagePanel from "./DataCategoryManagePanel.tsx";
import DataAppEditCategoryPicker from "./DataAppEditCategoryPicker.tsx";
import DataAppEditItemPicker from "./DataAppEditItemPicker.tsx";

/**
 * 「应用设置」弹窗：双击应用趋势里的一行打开，能改**多个分类 + 多个事项**（+ 分类增删改查）。
 *
 * ## 为什么是两层组件
 *
 * 外层只做一件事：`app === null` 时**不挂载**内层。于是"关闭即丢弃草稿"是免费得到的 ——
 * 内层一卸载，草稿、错误提示、局部弹窗状态全部回到初值，不存在"下次打开带着上次残留"。
 * 这比在关闭时逐个 `setState(null)` 更彻底（后者只要漏一个字段就会带上残留）。
 *
 * ## 数据从哪来
 *
 * 全部走既有通道，**不新增 IPC 命令**（insight 命令数被 contract 门禁钉着）：
 * 读 = `ClassificationService.loadClassificationBootstrap()` + `listAppItemBindingOptions()`；
 * 写 = `saveQuickClassificationOverride()`（application override 的那条老路）；
 * 分类增删改 = `commitClassificationSettingMutations()` + `categoryDefinitionMutations` 的既有 builder。
 */
export interface DataAppEditDialogApp extends AppEditDialogTarget {
  iconUrl?: string;
}

interface Props {
  app: DataAppEditDialogApp | null;
  onClose: () => void;
  onSaved?: () => void;
}

export default function DataAppEditDialog({ app, onClose, onSaved }: Props) {
  if (!app) return null;
  return <DataAppEditDialogSurface app={app} onClose={onClose} onSaved={onSaved} />;
}

function DataAppEditDialogSurface({
  app,
  onClose,
  onSaved,
}: Props & { app: DataAppEditDialogApp }) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = APP_EDIT_COPY[locale];
  const state = useAppEditDialog({ target: app, onClose, onSaved });
  const busy = state.saving || state.managing;
  const checkedCategories = state.categoryOptions.filter(
    (option) => state.draft.categories.includes(option.value),
  );

  return (
    <QuietDialog
      open
      title={(
        <span className="qp-app-edit-heading">
          {app.iconUrl ? <img className="qp-app-edit-icon" src={app.iconUrl} alt="" draggable={false} /> : null}
          <span className="qp-app-edit-app-name">{app.displayName}</span>
          <span className="qp-app-edit-kicker">{copy.title}</span>
        </span>
      )}
      surfaceClassName="qp-app-edit-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
      actions={(
        <>
          <QuietButton tone="secondary" onClick={onClose} disabled={busy}>
            {UI_TEXT.dialog.cancel}
          </QuietButton>
          <QuietButton tone="primary" onClick={state.save} disabled={!state.canSave || busy}>
            {state.saving ? UI_TEXT.mapping.quickSaving : UI_TEXT.mapping.quickSave}
          </QuietButton>
        </>
      )}
    >
      {state.error ? <p className="qp-app-edit-issue" role="status">{state.error}</p> : null}
      {state.loading ? (
        <p className="qp-app-edit-hint" role="status">{UI_TEXT.common.loading}</p>
      ) : (
        <>
          <DataAppEditCategoryPicker
            options={state.categoryOptions}
            draft={state.draft}
            disabled={busy}
            labels={{
              title: copy.categories,
              hint: copy.categoriesHint,
              primaryBadge: copy.primaryBadge,
              setPrimary: copy.setPrimary,
            }}
            onToggle={state.toggleCategory}
            onPromote={state.promoteCategory}
          />
          <DataAppEditItemPicker
            items={state.items}
            draft={state.draft}
            checkedCategories={checkedCategories}
            disabled={busy}
            loadFailed={state.itemsLoadFailed}
            labels={{
              title: copy.items,
              hint: copy.itemsHint,
              empty: copy.itemsEmpty,
              loadFailed: copy.itemsLoadFailed,
              followPrimary: copy.followPrimary,
            }}
            onToggle={state.toggleItem}
            onAssign={state.assignItemCategory}
          />
          {/* [本轮] 分类管理整段走共用件 `DataCategoryManagePanel`：数据页那个独立弹窗装的是
              **同一个组件**（改名弹窗与提示/确认框都在它里面），所以两处永远长得一样。
              `null` 色值 = 「恢复默认颜色」（写 `value: null` = 删掉覆盖），不能当"没选色"过滤。 */}
          <DataCategoryManagePanel
            options={state.categoryOptions}
            usage={state.categoryUsage}
            disabled={busy}
            managing={state.managing}
            labels={{ title: copy.manage, usage: copy.usageCount, createColorHint: copy.createColorHint }}
            onCreate={(label, color) => { void state.createCategory(label, color); }}
            onRename={state.renameCategory}
            onDelete={(category) => { void state.deleteCategory(category); }}
            onApplyColor={(category, color) => { void state.recolorCategory(category, color); }}
            dialogsElement={state.dialogsElement}
          />
        </>
      )}
    </QuietDialog>
  );
}
