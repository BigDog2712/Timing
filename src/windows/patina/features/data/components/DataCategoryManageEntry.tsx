import { useLocale } from "../../../shared/i18n/index.ts";
import { APP_EDIT_COPY } from "../appEditCopy.ts";
import DataCategoryManageDialog from "./DataCategoryManageDialog.tsx";

/**
 * 分类 tab 的「管理分类」入口 + 它打开的弹窗（[本轮]，一个组件里两件事）。
 *
 * ## 为什么合在一起
 *
 * 两处的开关是**同一个**：`useAppTrendRowEdit` 里的 `categoryManageOpen`（双击分类行与
 * 点这颗键都写它）。如果入口与弹窗分成两个元素，宿主面板就得为同一件事写两段 JSX；
 * 合成一个之后面板只多一行，而弹窗本来 `portal` 到 body，DOM 位置无所谓。
 *
 * ## 入口的位置
 *
 * 搜索框下面、列表上面（`data-category-manage-row` 是通栏 24px 的窄行，右对齐）：搜索那一行
 * 要留给"搜什么"，塞进一颗常驻按钮会把输入宽度挤掉一半；放列表**上方**又比放下面好 ——
 * 先看到"这些分类可以管"，再往下看具体有哪些。
 *
 * ## 只在分类 tab 出现
 *
 * `visible` 为假（应用 / 网页 tab）时只挂弹窗、不画键：在应用 tab 上给一条「管理分类」
 * 会让人以为能改应用分类。
 */
export default function DataCategoryManageEntry({
  visible,
  open,
  onOpen,
  onClose,
  onChanged,
}: {
  visible: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** 任何一次写成功之后通知页面重取数（趋势图按分类着色 / 排行会变） */
  onChanged?: () => void;
}) {
  const copy = APP_EDIT_COPY[useLocale()];
  return (
    <>
      {visible ? (
        <div className="data-category-manage-row">
          <button type="button" className="qp-link-btn data-category-manage-action" onClick={onOpen}>
            {copy.manageAction}
          </button>
        </div>
      ) : null}
      <DataCategoryManageDialog open={open} onClose={onClose} onChanged={onChanged} />
    </>
  );
}
