import { useState, type ReactNode } from "react";

import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import QuickClassificationRenameDialog from "../../classification/components/QuickClassificationRenameDialog.tsx";
import type { AppEditCategoryOption } from "../hooks/useAppEditCategoryAdmin.ts";
import DataAppEditCategoryManager from "./DataAppEditCategoryManager.tsx";

/**
 * 「分类管理」这段**内容**（不含弹窗外壳）：两个入口共用同一份 UI。
 *
 * 为什么拆成"内容"而不是直接做成弹窗：它有两个宿主。
 *   · `DataAppEditDialog`（双击应用趋势的一行）把它当作弹窗里的**第三段**；
 *   · `DataCategoryManageDialog`（数据页分类 tab 的「管理分类」/ 双击分类行）把它整段装进
 *     自己的弹窗。
 * 如果这里自己开 `QuietDialog`，第一种宿主就会变成"弹窗里再套一层弹窗"——用户点开应用设置
 * 之后还要再点一次才看得到分类，且那一层的关闭语义与外面那层不一致。
 *
 * 所以这里只负责三件事：把行交给 `DataAppEditCategoryManager`、持有改名弹窗的状态
 * （改名弹窗由**弹窗层**持有，不能从一段内容里再开一层）、把 `useQuietDialogs` 的
 * 提示/确认节点挂上去。增删改查的编排全在 `useAppEditCategoryAdmin`，本文件不碰写库。
 */
export interface DataCategoryManagePanelLabels {
  /** 这一段的标题（「分类管理」） */
  title: string;
  /** 每行的用量读数：多少个应用/域名正指着它 */
  usage: (count: number) => string;
  /** 新建行未选色时的小字 / 色块 tooltip（「不选色则按调色板自动取色」） */
  createColorHint: string;
}

interface Props {
  options: readonly AppEditCategoryOption[];
  usage: Readonly<Record<string, number>>;
  disabled: boolean;
  /** 正在写库（改名弹窗的保存键跟着它转圈） */
  managing: boolean;
  labels: DataCategoryManagePanelLabels;
  onCreate: (label: string, color: string | null) => void;
  onRename: (category: AppCategory, label: string) => Promise<void>;
  onDelete: (category: AppCategory) => void;
  /** `null` = 恢复默认色（写 `value: null`），不是"什么都不做" */
  onApplyColor: (category: AppCategory, color: string | null) => void;
  /** `useQuietDialogs` 的提示框 / 确认框节点（新建重名、删除确认） */
  dialogsElement: ReactNode;
}

export default function DataCategoryManagePanel({
  options,
  usage,
  disabled,
  managing,
  labels,
  onCreate,
  onRename,
  onDelete,
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
