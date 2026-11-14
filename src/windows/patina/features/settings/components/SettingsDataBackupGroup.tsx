import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietButton from "../../../shared/components/QuietButton";
import type { RefObject } from "react";
import type { RemoteBackupEntry, RemoteBackupState } from "../hooks/useRemoteBackupState.ts";
import SettingsRemoteBackupPanel from "./SettingsRemoteBackupPanel";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";

/**
 * 「存储」卡 · 活动库备份与恢复（含 WebDAV 远端那一路）。
 *
 * 三段都是"动作 + 一个按钮"，所以每段一行 `SettingsPreferenceRow`；远端那一行由
 * `SettingsRemoteBackupPanel` 自己画（它还带三个弹窗：配置 / 上传 / 远端列表），
 * 这里只把它排在同一个 `.settings-preference-list` 里 —— 行距与分隔线才和上面两行一致。
 *
 * `busy` 的口径原样保留：备份键 busy = 本地导出中 ∨ 远端上传中；恢复键 busy =
 * 本地恢复中 ∨ 远端列表拉取中 ∨ 远端下载中。文案在 busy 时切成「备份中…」「恢复中…」。
 */
export default function SettingsDataBackupGroup({
  busy,
  isExportingBackup,
  isRestoringBackup,
  remoteBackup,
  backupButtonRef,
  restoreButtonRef,
  onBackupAction,
  onRestoreAction,
  onRestoreEntrySelected,
}: {
  busy: boolean;
  isExportingBackup: boolean;
  isRestoringBackup: boolean;
  remoteBackup: RemoteBackupState;
  backupButtonRef: RefObject<HTMLButtonElement | null>;
  restoreButtonRef: RefObject<HTMLButtonElement | null>;
  onBackupAction: () => void;
  onRestoreAction: () => void;
  onRestoreEntrySelected: (entry: RemoteBackupEntry) => void;
}) {
  const UI_TEXT = useLocaleText();
  const exporting = isExportingBackup || remoteBackup.isUploading;
  const restoring = isRestoringBackup || remoteBackup.isListing || remoteBackup.isDownloading;
  return (
    <SettingsPreferenceGroup title={UI_TEXT.settings.backupRestoreTitle}>
      <QuietActionRow className="settings-preference-list">
        <SettingsPreferenceRow title={UI_TEXT.settings.backupExportTitle}>
          <QuietButton
            ref={backupButtonRef}
            size="compact"
            onClick={onBackupAction}
            disabled={busy}
            busy={exporting}
          >
            {exporting ? UI_TEXT.settings.backupExporting : UI_TEXT.settings.backupExportAction}
          </QuietButton>
        </SettingsPreferenceRow>
        <SettingsPreferenceRow title={UI_TEXT.settings.backupRestoreActionTitle}>
          <QuietButton
            ref={restoreButtonRef}
            size="compact"
            onClick={onRestoreAction}
            disabled={busy}
            busy={restoring}
          >
            {restoring ? UI_TEXT.settings.backupRestoring : UI_TEXT.settings.backupRestoreAction}
          </QuietButton>
        </SettingsPreferenceRow>
        <SettingsRemoteBackupPanel
          remoteBackup={remoteBackup}
          onRestoreEntrySelected={onRestoreEntrySelected}
        />
      </QuietActionRow>
    </SettingsPreferenceGroup>
  );
}
