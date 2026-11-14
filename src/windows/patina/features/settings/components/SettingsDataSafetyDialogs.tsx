import { CircleAlert, RefreshCw, Trash2, X } from "lucide-react";
import { lazy, Suspense } from "react";

import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietButton from "../../../shared/components/QuietButton";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import QuietStepperSlider from "../../../shared/components/QuietStepperSlider.tsx";
import QuietTooltip from "../../../shared/components/QuietTooltip";
import SettingsRemoteUploadDialog from "./SettingsRemoteUploadDialog";
import { formatRemoteBackupTargetSummary } from "../services/remoteBackupTargetSummary.ts";
import type { SettingsDataSafetyDialogsState } from "../hooks/useSettingsDataSafetyDialogs.ts";

const settingsBackupDialogModule = import("./SettingsBackupDialog");
const SettingsBackupDialog = lazy(() => settingsBackupDialogModule);

/**
 * 「存储」卡的那五个对话框（[本轮] 从 695 行的 `SettingsDataSafetyPanel` 抽出来的**画**那半，
 * 状态在 `useSettingsDataSafetyDialogs`）。顺序与原来一致：
 *   ① 清理历史记录（含档位滑杆）② 清理缓存（重启并应用）③ 选备份位置 ④ 选恢复来源 ⑤ 恢复策略。
 * 行为零改动：按钮文案、`busy` 门控、`closeOnBackdrop`、焦点落点全部逐字保留 ——
 * 这一层只把 hook 给的标志位翻成 JSX。
 */
export default function SettingsDataSafetyDialogs({
  state,
  busy,
}: {
  state: SettingsDataSafetyDialogsState;
  busy: boolean;
}) {
  const {
    UI_TEXT,
    isCleaning,
    isRestoringBackup,
    remoteBackup,
    hasRemoteBackupTarget,
    restoreStrategy,
    onRestoreStrategyChange,
    onExportBackup,
    refs,
    flags,
    uploadTarget,
    restoreStrategyOptions,
    cleanupSliderOptions,
    cleanupRangeIndex,
    cleanupRange,
    selectedCleanupOption,
    updateCleanupRangeIndex,
  } = state;
  const storageText = UI_TEXT.settings.storage;

  return (
    <>
      <QuietDialog
        open={flags.historyCleanupDialogOpen}
        title={UI_TEXT.settings.cleanupTitle}
        description={UI_TEXT.settings.cleanupHint}
        onClose={state.closeHistoryCleanup}
        closeOnBackdrop={!isCleaning}
        surfaceClassName="settings-history-cleanup-dialog"
        actions={(
          <>
            <QuietButton size="large" onClick={state.closeHistoryCleanup} disabled={isCleaning}>
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="danger"
              size="large"
              onClick={state.cleanupHistoryFromDialog}
              disabled={isCleaning}
            >
              {isCleaning ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {isCleaning ? UI_TEXT.settings.cleanupRunning : UI_TEXT.settings.cleanupNow}
            </QuietButton>
          </>
        )}
      >
        <div className="settings-history-cleanup-range">
          <span>{UI_TEXT.settings.cleanupRangeLabel}</span>
          <QuietStepperSlider
            ariaLabel={UI_TEXT.settings.cleanupRangeLabel}
            value={cleanupRangeIndex}
            min={0}
            max={Math.max(0, cleanupSliderOptions.length - 1)}
            displayValue={selectedCleanupOption?.label ?? UI_TEXT.settings.cleanupRangeLabels[cleanupRange]}
            decreaseAriaLabel={UI_TEXT.settings.decreaseCleanupRange}
            increaseAriaLabel={UI_TEXT.settings.increaseCleanupRange}
            className="settings-history-cleanup-slider"
            onChange={updateCleanupRangeIndex}
          />
        </div>
      </QuietDialog>

      <QuietDialog
        open={flags.cacheClearDialogOpen}
        title={storageText.webviewCacheClearConfirmTitle}
        description={storageText.webviewCacheClearConfirmDetail}
        onClose={state.closeCacheClear}
        closeOnBackdrop={!busy}
        initialFocusRef={refs.cacheClearCancelRef}
        actions={(
          <>
            <QuietButton
              ref={refs.cacheClearCancelRef}
              size="large"
              onClick={state.closeCacheClear}
              disabled={busy}
              className="rounded-[8px]"
            >
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={state.restartAndClearWebviewCacheFromDialog}
              disabled={busy}
              className="rounded-[8px]"
            >
              {storageText.restartAndApplyAction}
            </QuietButton>
          </>
        )}
      />

      {flags.backupTargetDialogOpen ? (
        <Suspense fallback={null}>
          <SettingsBackupDialog
            open
            busy={busy}
            hasRemoteBackupTarget={hasRemoteBackupTarget}
            remoteBackupTargetSummary={formatRemoteBackupTargetSummary(remoteBackup.config)}
            onClose={state.closeBackupTarget}
            onLocalBackup={() => {
              state.closeBackupTarget();
              onExportBackup();
            }}
            onRemoteBackup={() => {
              state.closeBackupTarget();
              if (remoteBackup.config) state.setUploadTarget({ ...remoteBackup.config });
            }}
          />
        </Suspense>
      ) : null}
      {uploadTarget ? (
        <SettingsRemoteUploadDialog
          target={uploadTarget}
          remoteBackup={remoteBackup}
          onClose={() => {
            state.setUploadTarget(null);
            requestAnimationFrame(() => refs.backupButtonRef.current?.focus());
          }}
        />
      ) : null}

      <QuietDialog
        open={flags.restoreSourceDialogOpen}
        title={UI_TEXT.settings.restoreSourceTitle}
        onClose={state.closeRestoreSource}
        closeOnBackdrop={!busy}
        initialFocusRef={refs.localRestoreRef}
        surfaceClassName="settings-data-action-dialog"
        headerAside={(
          <div className="settings-dialog-header-actions">
            <button
              type="button"
              className="qp-dialog-close-button"
              aria-label={UI_TEXT.common.close}
              disabled={busy}
              onClick={state.closeRestoreSource}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <QuietActionRow className="settings-dialog-action-card">
            <div className="settings-dialog-action-composite" data-disabled={busy ? "true" : undefined}>
              <button
                ref={refs.localRestoreRef}
                type="button"
                onClick={() => {
                  state.closeRestoreSource();
                  void state.prepareLocalRestore();
                }}
                disabled={busy}
                className="settings-dialog-action-hit-target"
                aria-label={UI_TEXT.settings.restoreSourceLocalTitle}
              />
              <div className="settings-dialog-action-copy settings-import-action-heading">
                <p className="qp-text-body qp-weight-medium text-[var(--qp-text-primary)]">
                  {UI_TEXT.settings.restoreSourceLocalTitle}
                </p>
                <QuietTooltip
                  label={UI_TEXT.settings.restoreSourceLocalHint}
                  placement="top"
                  tooltipClassName="settings-help-tooltip"
                  hideOnPointerDown={false}
                >
                  <button
                    type="button"
                    className="settings-help-icon"
                    aria-label={UI_TEXT.settings.restoreSourceLocalHint}
                  >
                    <CircleAlert size={13} aria-hidden="true" />
                  </button>
                </QuietTooltip>
              </div>
            </div>
          </QuietActionRow>
          <QuietActionRow className="settings-dialog-action-card">
            <div className="settings-dialog-action-composite" data-disabled={busy ? "true" : undefined}>
              <button
                type="button"
                onClick={() => {
                  state.closeRestoreSource();
                  void state.openRemoteRestoreList();
                }}
                disabled={busy}
                className="settings-dialog-action-hit-target"
                aria-label={UI_TEXT.settings.restoreSourceRemoteTitle}
              />
              <div className="settings-dialog-action-copy settings-import-action-heading">
                <p className="qp-text-body qp-weight-medium text-[var(--qp-text-primary)]">
                  {UI_TEXT.settings.restoreSourceRemoteTitle}
                </p>
                <QuietTooltip
                  label={UI_TEXT.settings.restoreSourceRemoteHint}
                  placement="top"
                  tooltipClassName="settings-help-tooltip"
                  hideOnPointerDown={false}
                >
                  <button
                    type="button"
                    className="settings-help-icon"
                    aria-label={UI_TEXT.settings.restoreSourceRemoteHint}
                  >
                    <CircleAlert size={13} aria-hidden="true" />
                  </button>
                </QuietTooltip>
              </div>
            </div>
          </QuietActionRow>
        </div>
      </QuietDialog>

      <QuietDialog
        open={flags.strategyDialogOpen}
        title={UI_TEXT.settings.restoreStrategyLabel}
        onClose={state.closeStrategyDialog}
        closeOnBackdrop={!isRestoringBackup}
        initialFocusRef={refs.selectedRestoreStrategyRef}
        actions={(
          <>
            <QuietButton
              size="large"
              onClick={state.closeStrategyDialog}
              disabled={isRestoringBackup}
              className="rounded-[8px]"
            >
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={state.confirmRestoreStrategy}
              disabled={busy}
              busy={isRestoringBackup || remoteBackup.isListing}
              className="rounded-[8px]"
            >
              {isRestoringBackup || remoteBackup.isListing
                ? UI_TEXT.settings.backupRestoring
                : UI_TEXT.settings.backupRestoreAction}
            </QuietButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <QuietSegmentedFilter
            variant="control"
            value={restoreStrategy}
            options={restoreStrategyOptions}
            onChange={onRestoreStrategyChange}
            selectedOptionRef={refs.selectedRestoreStrategyRef}
            className="self-start"
          />
        </div>
      </QuietDialog>
    </>
  );
}
