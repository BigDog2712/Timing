import { RefreshCw, Trash2 } from "lucide-react";

import QuietButton from "../../../shared/components/QuietButton";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietStepperSlider from "../../../shared/components/QuietStepperSlider.tsx";
import type { SettingsDataSafetyDialogsState } from "../hooks/useSettingsDataSafetyDialogs.ts";

/**
 * 「存储」卡的那两个对话框（状态在 `useSettingsDataSafetyDialogs`）：
 *   ① 清理历史记录（含档位滑杆）② 清理缓存（重启并应用）。
 *
 * [设置页七项改造·批 5] 原来的 ③ 选备份位置 ④ 选恢复来源 ⑤ 恢复策略 随
 * 「活动库备份与恢复」整块下线。剩下两个的行为逐字未改（`busy` 门控、`closeOnBackdrop`、
 * 焦点落点），只是不再需要 `SettingsBackupDialog` / `SettingsRemoteUploadDialog` 这两个
 * `lazy()` 兄弟 —— 这也顺带把这条路径上的模块加载砍掉了。
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
    refs,
    flags,
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
    </>
  );
}
