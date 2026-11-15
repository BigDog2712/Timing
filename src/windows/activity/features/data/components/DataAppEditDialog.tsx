import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { APP_EDIT_COPY } from "../appEditCopy.ts";
import { useAppEditDialog, type AppEditDialogTarget } from "../hooks/useAppEditDialog.ts";
import DataAppEditCategoryPicker from "./DataAppEditCategoryPicker.tsx";
import DataAppEditItemPicker from "./DataAppEditItemPicker.tsx";

/**
 * 「应用设置」弹窗：双击应用趋势里的一行打开，只做两件事 —— 改**多个分类 + 多个事项**。
 *
 * ## [本轮] 分类管理搬走了
 *
 * 第三段「分类管理」原来长在这里，于是同一个弹层里既有"给这个应用挑分类"又有"全局增删改
 * 分类"：前者是**一次设置**，后者是**一处配置**，混在一起的结果是用户想删一个建错的分类
 * 得先找一个恰好属于它的应用双击。现在增删改只走分类趋势页的「管理分类」
 * （`DataCategoryManageDialog`），本弹窗不再持有分类定义的任何写入口。
 *
 * 连带的后端事实：`useAppEditDialog` 里那条 `useAppEditCategoryAdmin` 也一并摘掉了 ——
 * 留着而没有消费方，等于留一条"随时能把分类删掉"的暗路。
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
 * 写 = `saveQuickClassificationOverride()`（application override 的那条老路）。
 * 分类定义的增删改这里一条都不碰 —— 那是「管理分类」弹窗的事。
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
  const busy = state.saving;
  const checkedCategories = state.categoryOptions.filter(
    (option) => state.draft.categories.includes(option.value),
  );

  return (
    <QuietDialog
      open
      title={(
        <span className="at-app-edit-heading">
          {app.iconUrl ? <img className="at-app-edit-icon" src={app.iconUrl} alt="" draggable={false} /> : null}
          <span className="at-app-edit-app-name">{app.displayName}</span>
          <span className="at-app-edit-kicker">{copy.title}</span>
        </span>
      )}
      surfaceClassName="at-app-edit-dialog"
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
      {state.error ? <p className="at-app-edit-issue" role="status">{state.error}</p> : null}
      {state.loading ? (
        <p className="at-app-edit-hint" role="status">{UI_TEXT.common.loading}</p>
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
        </>
      )}
    </QuietDialog>
  );
}
