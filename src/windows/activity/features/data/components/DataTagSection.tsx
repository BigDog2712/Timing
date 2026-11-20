/**
 * 数据页的标签面（[0.12.4]）
 * -----------------------------------------------------------------------------
 * 两件事挤在同一个组件里，是因为它们共用一个数据源（`useTagAdmin`：定义行 + 引用数）：
 *   1. 数据区域下方的**标签管理区块**（`DataTagManagerPanel`）；
 *   2. 双击应用行弹出的**应用标签编辑**（`AppTagDialog`）。
 *
 * 抽出来的理由只是体积与归属：`Data.tsx` 已经太长，而这两块与趋势图 / 热力图没有
 * 任何数据依赖。弹窗走 `createPortal`，所以它在 DOM 里挂哪儿都不影响布局。
 */
import AppTagDialog from "../../dashboard/components/AppTagDialog.tsx";
import type { QuietToastTone } from "../../../shared/types/toast.ts";
import { useTagAdmin } from "../hooks/useTagAdmin.ts";
import DataTagManagerPanel from "./DataTagManagerPanel.tsx";

export interface AppTagTarget {
  exeName: string;
  name: string;
}

interface Props {
  /** 正在编辑标签的应用；`null` = 弹窗关着 */
  target: AppTagTarget | null;
  onClose: () => void;
  /** 应用标签写成功之后：页面要重取 override（排行上的标签 chip 才会变） */
  onSaved: () => void;
  onError: (message: string) => void;
  onToast?: (message: string, tone?: QuietToastTone) => void;
}

export default function DataTagSection({
  target,
  onClose,
  onSaved,
  onError,
  onToast,
}: Props) {
  const state = useTagAdmin();
  return (
    <>
      {/* 数据区域下方的独立区块：层级 / 增删改 / 搜索 */}
      <div className="mt-4">
        <DataTagManagerPanel
          state={state}
          onError={(message) => onToast?.(message, "error")}
          /* 批量打标签会改 override → 排行上的标签 chip 也要重读（同一个 onSaved） */
          onAfterBulkApply={onSaved}
        />
      </div>
      {target ? (
        <AppTagDialog
          key={target.exeName}
          exeName={target.exeName}
          displayName={target.name}
          onClose={onClose}
          /* 弹窗保存时会给新标签补定义行：重读一遍标签树，管理处当场就能看到 */
          onSaved={() => {
            void state.reload();
            onSaved();
          }}
          onError={onError}
        />
      ) : null}
    </>
  );
}
