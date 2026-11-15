import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";

import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import QuickClassificationRenameDialog from "../../classification/components/QuickClassificationRenameDialog.tsx";
import type { AppEditCategoryOption } from "../hooks/useAppEditCategoryAdmin.ts";
import DataAppEditCategoryManager from "./DataAppEditCategoryManager.tsx";

/**
 * 「分类管理」这段**内容**（不含弹窗外壳）。
 *
 * 为什么拆成"内容"而不是直接做成弹窗：改名弹窗与提示/确认框必须由**弹窗层**持有 ——
 * 内容层自己再开一层 `QuietDialog` 就变成"弹窗里套弹窗"，关闭语义与外面那层也不一致。
 * （[本轮] 它现在只剩一个宿主 `DataCategoryManageDialog`：应用设置弹窗里那段已摘除。）
 *
 * 所以这里只负责三件事：把行交给 `DataAppEditCategoryManager`、持有改名弹窗的状态、
 * 把 `useQuietDialogs` 的提示/确认节点挂上去。增删改查的编排全在 `useAppEditCategoryAdmin`，
 * 本文件不碰写库。
 *
 * ## [本轮] 底部多一行「已删除」
 *
 * 内置分类删掉之后会从列表里彻底消失（它本来就是从可选项里移除）。没有这一行，
 * 删错了就只剩"改库"一条路 —— 而删除键现在就在每一行上，误点的概率不低。
 * 恢复写的是 `__deleted_category::` 的 null，只把"可选项"身份还回来；名字与颜色在删除时
 * 已被清掉，所以恢复出来的是原厂分类（删除确认框里如实写了这一点）。
 */
export interface DataCategoryManagePanelLabels {
  /** 这一段的标题（「分类管理」） */
  title: string;
  /** 每行的用量读数：多少个应用/域名正指着它 */
  usage: (count: number) => string;
  /** 新建行未选色时的小字 / 色块 tooltip（「不选色则按调色板自动取色」） */
  createColorHint: string;
  /** 「已删除」那一行前面的说明（「已删除，点一下恢复」） */
  deletedHint: string;
}

interface Props {
  options: readonly AppEditCategoryOption[];
  usage: Readonly<Record<string, number>>;
  /** 已删除的内置分类（列表里已经看不到它们了，这里是唯一的恢复入口） */
  deletedOptions: readonly { value: AppCategory; label: string }[];
  disabled: boolean;
  /** 正在写库（改名弹窗的保存键跟着它转圈） */
  managing: boolean;
  labels: DataCategoryManagePanelLabels;
  onCreate: (label: string, color: string | null) => void;
  onRename: (category: AppCategory, label: string) => Promise<void>;
  onDelete: (category: AppCategory) => void;
  /** 把已删除的内置分类放回可选项 */
  onRestore: (category: AppCategory) => void;
  /** `null` = 恢复默认色（写 `value: null`），不是"什么都不做" */
  onApplyColor: (category: AppCategory, color: string | null) => void;
  /** `useQuietDialogs` 的提示框 / 确认框节点（新建重名、删除确认） */
  dialogsElement: ReactNode;
}

export default function DataCategoryManagePanel({
  options,
  usage,
  deletedOptions,
  disabled,
  managing,
  labels,
  onCreate,
  onRename,
  onDelete,
  onRestore,
  onApplyColor,
  dialogsElement,
}: Props) {
  /* 改名弹窗由这里持有：`DataAppEditCategoryManager` 只发"想改这一行"的请求 */
  const [renameTarget, setRenameTarget] = useState<{ category: AppCategory; label: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  return (
    <>
      <DataAppEditCategoryManager
        options={options}
        usage={usage}
        disabled={disabled}
        labels={{ title: labels.title, usage: labels.usage, createColorHint: labels.createColorHint }}
        onCreate={onCreate}
        onRequestRename={(category, label) => {
          setRenameTarget({ category, label });
          setRenameValue(label);
        }}
        onDelete={onDelete}
        onApplyColor={onApplyColor}
      />
      {deletedOptions.length > 0 ? (
        <div className="qp-category-restore-row">
          <span className="qp-app-edit-hint">{labels.deletedHint}</span>
          {deletedOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="qp-link-btn qp-category-restore-action"
              /* 不复用 `data-category`：那个属性在分类行上表示"这一行是某个分类"，
                 恢复键是另一件事（它列的分类当前并不在列表里），混用会让按行查询的
                 选择器把恢复键也捞进去。 */
              data-restore-category={option.value}
              disabled={disabled}
              onClick={() => onRestore(option.value)}
            >
              <RotateCcw size={11} aria-hidden="true" /> {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <QuickClassificationRenameDialog
        open={renameTarget !== null}
        saving={managing}
        value={renameValue}
        currentDisplayName={renameTarget?.label ?? ""}
        fallbackName={renameTarget?.label ?? ""}
        onChange={setRenameValue}
        onSubmit={() => {
          if (!renameTarget) return;
          void onRename(renameTarget.category, renameValue).then(() => setRenameTarget(null));
        }}
        onClose={() => setRenameTarget(null)}
      />
      {/* 提示框 / 确认框自己 portal 到 body：内容层不许自己造第二个浮层根 */}
      {dialogsElement}
    </>
  );
}
