import { useEffect, useRef, useState } from "react";

import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { CleanupRange } from "../types";
import type { BackupRestoreStrategy } from "../services/settingsRuntimeAdapterService.ts";
import type { RemoteBackupEntry, RemoteBackupState } from "../hooks/useRemoteBackupState.ts";

/**
 * 「存储」卡里那五个对话框的**状态机**（[本轮] 从 `SettingsDataSafetyPanel` 抽出来的）。
 *
 * 为什么抽：那几个 `useState` / `useRef` / 「关掉远端列表后把焦点还给恢复键」的 effect
 * 与"哪一行触发了哪个框"是同一件事，散在面板里就只能和行排版挤在同一个文件 —— 而那个
 * 文件 695 行、冻结在 size 门禁里。状态机单独一份之后，面板只做组合，对话框层只画。
 *
 * 行为零改动：每个 `open*` 都是原来那颗按钮的 `onClick` 逐字搬过来的（含 `busy` 门控、
 * 远端列表的焦点回归、以及"策略确认之后按来源分派到本地/远端"的分支）。
 */
interface Params {
  cleanupRange: CleanupRange;
  cleanupOptions: readonly { value: CleanupRange; label: string }[];
  restoreStrategy: BackupRestoreStrategy;
  onCleanupRangeChange: (value: CleanupRange) => void;
  isCleaning: boolean;
  isRestoringBackup: boolean;
  remoteBackup: RemoteBackupState;
  onRestoreStrategyChange: (value: BackupRestoreStrategy) => void;
  onCleanup: () => void;
  onExportBackup: () => void;
  onPrepareRestoreBackup: () => Promise<boolean | void>;
  onRestoreBackup: (restoreStrategy: BackupRestoreStrategy) => void;
  onClearPendingRestoreBackup: () => void;
  onScheduleWebviewCacheClear: () => Promise<void> | void;
}

export type RestoreStrategyOption = { value: BackupRestoreStrategy; label: string; tooltip: string };

export function useSettingsDataSafetyDialogs({
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
}: Params) {
  const UI_TEXT = useLocaleText();
  const cacheClearCancelRef = useRef<HTMLButtonElement>(null);
  const localRestoreRef = useRef<HTMLButtonElement>(null);
  const backupButtonRef = useRef<HTMLButtonElement>(null);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const selectedRestoreStrategyRef = useRef<HTMLButtonElement>(null);
  const wasRemoteListOpen = useRef(false);

  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [restoreStrategySource, setRestoreStrategySource] = useState<"local" | "remote">("local");
  const [pendingRemoteRestoreEntry, setPendingRemoteRestoreEntry] = useState<RemoteBackupEntry | null>(null);
  const [backupTargetDialogOpen, setBackupTargetDialogOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<RemoteBackupState["config"]>(null);
  const [restoreSourceDialogOpen, setRestoreSourceDialogOpen] = useState(false);
  const [cacheClearDialogOpen, setCacheClearDialogOpen] = useState(false);
  const [historyCleanupDialogOpen, setHistoryCleanupDialogOpen] = useState(false);

  /* 远端备份列表关掉之后把焦点还给「恢复活动库」：不还的话焦点落在 body 上，
     Tab 一下回到页首 —— 键盘用户会以为弹窗把页面弄坏了。 */
  useEffect(() => {
    const closed = wasRemoteListOpen.current && !remoteBackup.restoreDialogOpen;
    wasRemoteListOpen.current = remoteBackup.restoreDialogOpen;
    if (!closed || strategyDialogOpen) return;
    const frame = requestAnimationFrame(() => restoreButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [remoteBackup.restoreDialogOpen, strategyDialogOpen]);

  const hasRemoteBackupTarget = Boolean(remoteBackup.config && remoteBackup.hasSecret);
  const restoreStrategyOptions: RestoreStrategyOption[] = [
    {
      value: "merge",
      label: UI_TEXT.settings.restoreStrategyOptions.merge,
      tooltip: UI_TEXT.settings.restoreStrategyOptionHints.merge,
    },
    {
      value: "replace",
      label: UI_TEXT.settings.restoreStrategyOptions.replace,
      tooltip: UI_TEXT.settings.restoreStrategyOptionHints.replace,
    },
  ];

  /* 清理档位：滑杆的档位就是 `cleanupOptions` 排序后的下标，不在前端硬编码档位表 */
  const cleanupSliderOptions = [...cleanupOptions].sort((left, right) => left.value - right.value);
  const cleanupRangeIndex = Math.max(
    0,
    cleanupSliderOptions.findIndex((option) => option.value === cleanupRange),
  );
  const selectedCleanupOption = cleanupSliderOptions[cleanupRangeIndex] ?? cleanupOptions[0];
  const updateCleanupRangeIndex = (nextIndex: number) => {
    const nextOption = cleanupSliderOptions[nextIndex];
    if (nextOption) {
      onCleanupRangeChange(nextOption.value);
    }
  };

  const prepareLocalRestore = async () => {
    setRestoreStrategySource("local");
    setPendingRemoteRestoreEntry(null);
    const prepared = await onPrepareRestoreBackup();
    if (prepared) {
      setStrategyDialogOpen(true);
    }
  };

  const openRemoteRestoreList = async () => {
    setRestoreStrategySource("remote");
    setPendingRemoteRestoreEntry(null);
    await remoteBackup.openRestoreDialog();
  };

  const confirmRestoreStrategy = () => {
    setStrategyDialogOpen(false);
    if (restoreStrategySource === "remote") {
      if (pendingRemoteRestoreEntry) {
        void remoteBackup.restoreEntry(pendingRemoteRestoreEntry, restoreStrategy);
      }
      setPendingRemoteRestoreEntry(null);
      return;
    }
    onRestoreBackup(restoreStrategy);
  };

  return {
    UI_TEXT,
    isCleaning,
    isRestoringBackup,
    remoteBackup,
    hasRemoteBackupTarget,
    restoreStrategy,
    onRestoreStrategyChange,
    onCleanup,
    onExportBackup,
    refs: { cacheClearCancelRef, localRestoreRef, backupButtonRef, restoreButtonRef, selectedRestoreStrategyRef },
    flags: {
      strategyDialogOpen,
      backupTargetDialogOpen,
      restoreSourceDialogOpen,
      cacheClearDialogOpen,
      historyCleanupDialogOpen,
    },
    uploadTarget,
    restoreStrategyOptions,
    cleanupSliderOptions,
    cleanupRange,
    cleanupRangeIndex,
    selectedCleanupOption,
    updateCleanupRangeIndex,
    openHistoryCleanup: () => setHistoryCleanupDialogOpen(true),
    openCacheClear: () => setCacheClearDialogOpen(true),
    openBackupTarget: () => setBackupTargetDialogOpen(true),
    closeBackupTarget: () => setBackupTargetDialogOpen(false),
    openRestore: () => {
      if (hasRemoteBackupTarget) {
        setRestoreSourceDialogOpen(true);
        return;
      }
      void prepareLocalRestore();
    },
    closeRestoreSource: () => setRestoreSourceDialogOpen(false),
    prepareLocalRestore,
    openRemoteRestoreList,
    handleRemoteRestoreEntrySelected: (entry: RemoteBackupEntry) => {
      remoteBackup.closeRestoreDialog();
      setRestoreStrategySource("remote");
      setPendingRemoteRestoreEntry(entry);
      setStrategyDialogOpen(true);
    },
    confirmRestoreStrategy,
    closeStrategyDialog: () => {
      setStrategyDialogOpen(false);
      setPendingRemoteRestoreEntry(null);
      onClearPendingRestoreBackup();
      requestAnimationFrame(() => restoreButtonRef.current?.focus());
    },
    restartAndClearWebviewCacheFromDialog: () => {
      setCacheClearDialogOpen(false);
      void onScheduleWebviewCacheClear();
    },
    cleanupHistoryFromDialog: () => {
      setHistoryCleanupDialogOpen(false);
      onCleanup();
    },
    setUploadTarget,
    closeCacheClear: () => setCacheClearDialogOpen(false),
    closeHistoryCleanup: () => setHistoryCleanupDialogOpen(false),
  };
}

export type SettingsDataSafetyDialogsState = ReturnType<typeof useSettingsDataSafetyDialogs>;
