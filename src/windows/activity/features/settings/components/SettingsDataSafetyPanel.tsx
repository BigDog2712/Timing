import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Database } from "lucide-react";

import type { CleanupRange } from "../types";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";
import { useSettingsDataSafetyDialogs } from "../hooks/useSettingsDataSafetyDialogs.ts";
import SettingsPanelHeader from "./SettingsPanelHeader";
import SettingsDataExportGroup from "./SettingsDataExportGroup";
import SettingsStoragePathsGroup from "./SettingsStoragePathsGroup";
import SettingsDataCleanupGroup from "./SettingsDataCleanupGroup";
import SettingsDataSafetyDialogs from "./SettingsDataSafetyDialogs";

/**
 * 设置 · 「数据安全」卡 —— 导出与导入 / 本机目录 / 清理，三组。
 *
 * ## [设置页七项改造·批 5] 「活动库备份与恢复」整块下线
 *
 * 原来这里还有一组「备份与恢复」：本机 zip 备份 + WebDAV 远端（上传 / 列表 / 下载 /
 * 删除）。用户口径是「我有计时数据导出，也要一份能整个搬走的备份」——现在这件事由
 * 「数据导出」与同步目录承担，活动库再单独一套备份/恢复只剩重复与误操作面
 * （两份不同的备份语义、两套恢复策略、一条会覆盖整库的远端还原）。
 *
 * 同时下线：`SettingsDataBackupGroup` / `SettingsBackupDialog` / `SettingsRemoteBackupPanel` /
 * `SettingsRemoteUploadDialog` / `useRemoteBackupState` / `remoteBackup*` 服务与
 * `platform/backup/{backupRuntimeGateway,remoteBackupRuntimeGateway}`，
 * 以及面板上的 `isExportingBackup` / `isRestoringBackup` / `restoreStrategy` / `remoteBackup`
 * 四组 props。**保留**：清理（含清理缓存要重启的二次确认）、导出与导入、本机目录三组。
 *
 * `busy` 口径随之收窄到三项：`isStorageBusy`（目录快照 / 迁移）、`isImportBusy`（导入）、
 * 以及清理自己的 `isCleaning`（它单独门控清理那一组）。
 */
type CleanupOption = { value: CleanupRange; label: string };

type SettingsDataSafetyPanelProps = {
  cleanupRange: CleanupRange;
  cleanupOptions: CleanupOption[];
  isCleaning: boolean;
  onCleanupRangeChange: (value: CleanupRange) => void;
  onCleanup: () => void;
  onOpenDataExport: () => void;
  onOpenDataImport: () => void;
  isImportBusy: boolean;
  storageSnapshot: StorageSnapshot | null;
  isStorageBusy: boolean;
  onRefreshStorageSnapshot: () => Promise<void> | void;
  onScheduleWebviewCacheClear: () => Promise<void> | void;
  onChooseCacheDirectory: () => Promise<void> | void;
  onRestoreDefaultCacheDirectory: () => Promise<void> | void;
  onOpenStorageDirectory: (path: string) => Promise<void> | void;
};

export default function SettingsDataSafetyPanel({
  cleanupRange,
  cleanupOptions,
  isCleaning,
  onCleanupRangeChange,
  onCleanup,
  onOpenDataExport,
  onOpenDataImport,
  isImportBusy,
  storageSnapshot,
  isStorageBusy,
  onRefreshStorageSnapshot,
  onScheduleWebviewCacheClear,
  onChooseCacheDirectory,
  onRestoreDefaultCacheDirectory,
  onOpenStorageDirectory,
}: SettingsDataSafetyPanelProps) {
  const UI_TEXT = useLocaleText();
  /* 任何一条长任务在跑就整组禁用：导入一半又去搬目录，两件事写同一份库 */
  const busy = isStorageBusy || isImportBusy;

  const dialogs = useSettingsDataSafetyDialogs({
    cleanupRange,
    cleanupOptions,
    onCleanupRangeChange,
    isCleaning,
    onCleanup,
    onScheduleWebviewCacheClear,
  });

  return (
    <>
      <section className="at-panel p-5 md:p-6">
        <SettingsPanelHeader
          icon={<Database size={16} className="text-[var(--at-accent-default)]" />}
          title={UI_TEXT.settings.dataSafetyTitle}
          className="mb-5"
        />

        {/* 与同页其它面板同构：`at-panel` 不带内边距，组间距靠 `space-y-5` */}
        <div className="space-y-5">
          <SettingsDataExportGroup
            busy={busy}
            onOpenDataExport={onOpenDataExport}
            onOpenDataImport={onOpenDataImport}
          />
          <SettingsStoragePathsGroup
            storageSnapshot={storageSnapshot}
            isStorageBusy={isStorageBusy}
            busy={busy}
            onRefreshStorageSnapshot={onRefreshStorageSnapshot}
            onChooseCacheDirectory={onChooseCacheDirectory}
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
