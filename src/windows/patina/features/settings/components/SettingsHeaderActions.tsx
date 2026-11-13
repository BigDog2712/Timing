/**
 * 设置页页头右侧的动作组（保存状态 + 取消 + 保存）
 * -----------------------------------------------------------------------------
 * [0.12.1 T04] 从 `Settings.tsx:164-209` 整段搬出：`Settings.tsx` 是**冻结 348 行**的文件，
 * 不抽走这 46 行就没有空间放 G1 与外观四张卡（设计 §9.1-R1 的「先抽后加」）。
 * 行为一字未改：同一套禁用条件、同一条 `busy`、同一组 class（`settings-header-button`）。
 *
 * 文案仍走 `useLocaleText()`（`settings.*` 既有键，**不新增 key**：i18n 的
 * `contract.ts` 本轮零余量）。
 */
import { RefreshCw, Save } from "lucide-react";
import QuietButton from "../../../shared/components/QuietButton";
import { useLocaleText } from "../../../shared/i18n/index.ts";

type SaveStatus = "idle" | "saving" | "saved";

interface SettingsHeaderActionsProps {
  saveStatus: SaveStatus;
  hasUnsavedChanges: boolean;
  /** 语言包切换中：整页会重挂，保存/取消一并挡住（与抽取前逐字一致） */
  blocked: boolean;
  onCancel: () => void;
  onSave: () => void;
}

export default function SettingsHeaderActions({
  saveStatus,
  hasUnsavedChanges,
  blocked,
  onCancel,
  onSave,
}: SettingsHeaderActionsProps) {
  const UI_TEXT = useLocaleText();
  const busy = saveStatus === "saving";
  const locked = !hasUnsavedChanges || busy || blocked;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5">
      <div
        className={`qp-status ${
          !busy && hasUnsavedChanges ? "qp-status-danger" : ""
        } flex px-3 py-1.5 rounded-[8px] items-center qp-text-caption qp-weight-emphasis`}
      >
        {busy && (
          <span className="text-[var(--qp-accent-default)] flex items-center gap-2">
            <RefreshCw size={12} className="animate-spin" />
            {UI_TEXT.settings.saving}
          </span>
        )}
        {saveStatus === "saved" && !hasUnsavedChanges && (
          <span className="text-[var(--qp-success)] flex items-center gap-1.5">
            <Save size={14} />
            {UI_TEXT.settings.saved}
          </span>
        )}
        {!busy && hasUnsavedChanges && <span>{UI_TEXT.settings.unsaved}</span>}
        {saveStatus === "idle" && !hasUnsavedChanges && (
          <span className="text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.idle}</span>
        )}
      </div>
      <QuietButton
        size="compact"
        onClick={onCancel}
        disabled={locked}
        className="settings-header-button rounded-[8px]"
      >
        {UI_TEXT.settings.cancel}
      </QuietButton>
      <QuietButton
        tone="primary"
        size="compact"
        onClick={onSave}
        disabled={locked}
        busy={busy}
        className="settings-header-button rounded-[8px]"
      >
        {busy ? UI_TEXT.settings.saving : UI_TEXT.settings.save}
      </QuietButton>
    </div>
  );
}
