import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Database } from "lucide-react";

import type { CleanupRange } from "../types";
import type { BackupRestoreStrategy } from "../services/settingsRuntimeAdapterService.ts";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";
import type { RemoteBackupState } from "../hooks/useRemoteBackupState.ts";
import { useSettingsDataSafetyDialogs } from "../hooks/useSettingsDataSafetyDialogs.ts";
import SettingsPanelHeader from "./SettingsPanelHeader";
import SettingsDataExportGroup from "./SettingsDataExportGroup";
import SettingsDataBackupGroup from "./SettingsDataBackupGroup";
import SettingsStoragePathsGroup from "./SettingsStoragePathsGroup";
import SettingsDataCleanupGroup from "./SettingsDataCleanupGroup";
import SettingsDataSafetyDialogs from "./SettingsDataSafetyDialogs";

/**
 * 设置 · 「存储」卡（原来的活动库备份与恢复面板）。
 *
 * ## [本轮] 只做组合，不再自己排行
 *
 * 这个文件曾经 695 行：四段动作行 + 三个目录行 + 五个对话框的状态机与 JSX 全挤在一起，
 * 而那一套行是**自定义**的（`settings-data-action-*` / `settings-storage-path-*` 那一族，
 * 已在 `settings.css` 里下线），与本页另外四组（`SettingsPreferenceGroup` +
 * `SettingsPreferenceRow`）的字重、行距、分隔线都对不上 —— 用户口径「数据管理部分 UI 太差」。
 *
 * 现在按语义拆成六块，本文件只做组合与 `busy` 汇总：
 *   · `SettingsDataExportGroup`    导出与导入
 *   · `SettingsDataBackupGroup`    活动库备份与恢复（含 WebDAV 远端那一路）
 *   · `SettingsStoragePathsGroup`  本机目录（安装 / 缓存 / 数据）
 *   · `SettingsDataCleanupGroup`   数据管理（清理缓存 / 清理历史记录）
 *   · `useSettingsDataSafetyDialogs` + `SettingsDataSafetyDialogs`  五个对话框
 * 行为零改动：每个回调、每处禁用态、每句文案都逐字保留（拆文件时不做顺手优化）。
 */
type CleanupOption = { value: CleanupRange; label: string };

type SettingsDataSafetyPanelProps = {
  cleanupRange: CleanupRange;
  cleanupOptions: CleanupOption[];
  restoreStrategy: BackupRestoreStrategy;
  isCleaning: boolean;
  isExportingBackup: boolean;
  isRestoringBackup: boolean;
  onCleanupRangeChange: (value: CleanupRange) => void;
  onRestoreStrategyChange: (value: BackupRestoreStrategy) => void;
  onCleanup: () => void;
  onExportBackup: () => void;
  onPrepareRestoreBackup: () => Promise<boolean | void>;
  onRestoreBackup: (restoreStrategy: BackupRestoreStrategy) => void;
  onClearPendingRestoreBackup: () => void;
  onOpenDataExport: () => void;
  onOpenDataImport: () => void;
  isImportBusy: boolean;
  remoteBackup: RemoteBackupState;
  storageSnapshot: StorageSnapshot | null;
  isStorageBusy: boolean;
  onRefreshStorageSnapshot: () => Promise<void> | void;
  onScheduleWebviewCacheClear: () => Promise<void> | void;
  onChooseDataDirectory: () => Promise<void> | void;
  onChooseCacheDirectory: () => Promise<void> | void;
  onRestoreDefaultDataDirectory: () => Promise<void> | void;
  onRestoreDefaultCacheDirectory: () => Promise<void> | void;
  onOpenStorageDirectory: (path: string) => Promise<void> | void;
};

export default function SettingsDataSafetyPanel({
  cleanupRange,
  cleanupOptions,
  restoreStrategy,
  isCleaning,
  isExportingBackup,
  isRestoringBackup,
  onCleanupRangeChange,
  onRestoreStrategyChange,
  onCleanup,
  onExportBackup,
  onPrepareRestoreBackup,
  onRestoreBackup,
  onClearPendingRestoreBackup,
  onOpenDataExport,
  onOpenDataImport,
  isImportBusy,
  remoteBackup,
  storageSnapshot,
  isStorageBusy,
  onRefreshStorageSnapshot,
  onScheduleWebviewCacheClear,
  onChooseDataDirectory,
  onChooseCacheDirectory,
  onRestoreDefaultDataDirectory,
  onRestoreDefaultCacheDirectory,
  onOpenStorageDirectory,
}: SettingsDataSafetyPanelProps) {
  const UI_TEXT = useLocaleText();
  /* 任何一条长任务在跑就整组禁用：导出的同时点恢复，两件事写同一份库 */
  const busy = isExportingBackup
    || isRestoringBackup
    || isStorageBusy
    || remoteBackup.isUploading
    || remoteBackup.isListing
    || remoteBackup.isDownloading
    || isImportBusy;

  const dialogs = useSettingsDataSafetyDialogs({
    cleanupRange,
    cleanupOptions,
    restoreStrategy,
    onCleanupRangeChange,
    isCleaning,
    isRestoringBackup,
    remoteBackup,
    onRestoreStrategyChange,
    onCleanup,
    onExportBackup,
    onPrepareRestoreBackup,
    onRestoreBackup,
    onClearPendingRestoreBackup,
    onScheduleWebviewCacheClear,
  });

  return (
    <>
      <section className="qp-panel p-5 md:p-6">
        <SettingsPanelHeader
          icon={<Database size={16} className="text-[var(--qp-accent-default)]" />}
          title={UI_TEXT.settings.dataSafetyTitle}
          className="mb-5"
        />

        {/* 与同页其它面板同构：`qp-panel` 不带内边距，组间距靠 `space-y-5` */}
        <div className="space-y-5">
          <SettingsDataExportGroup
            busy={busy}
            onOpenDataExport={onOpenDataExport}
            onOpenDataImport={onOpenDataImport}
          />
          <SettingsDataBackupGroup
            busy={busy}
            isExportingBackup={isExportingBackup}
            isRestoringBackup={isRestoringBackup}
            remoteBackup={remoteBackup}
            backupButtonRef={dialogs.refs.backupButtonRef}
            restoreButtonRef={dialogs.refs.restoreButtonRef}
            onBackupAction={dialogs.openBackupTarget}
            onRestoreAction={dialogs.openRestore}
            onRestoreEntrySelected={dialogs.handleRemoteRestoreEntrySelected}
          />
          <SettingsStoragePathsGroup
            storageSnapshot={storageSnapshot}
            isStorageBusy={isStorageBusy}
            busy={busy}
            onRefreshStorageSnapshot={onRefreshStorageSnapshot}
            onChooseDataDirectory={onChooseDataDirectory}
            onChooseCacheDirectory={onChooseCacheDirectory}
            onRestoreDefaultDataDirectory={onRestoreDefaultDataDirectory}
            onRestoreDefaultCacheDirectory={onRestoreDefaultCacheDirectory}
            onOpenStorageDirectory={onOpenStorageDirectory}
          />
          <SettingsDataCleanupGroup
            busy={busy}
            isCleaning={isCleaning}
            onOpenCacheClear={dialogs.openCacheClear}
            onOpenHistoryCleanup={dialogs.openHistoryCleanup}
          />
        </div>
      </section>

      <SettingsDataSafetyDialogs state={dialogs} busy={busy} />
    </>
  );
}
