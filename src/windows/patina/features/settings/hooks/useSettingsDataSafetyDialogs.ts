import { useRef, useState } from "react";

import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { CleanupRange } from "../types";

/**
 * 「存储」卡里那两个对话框的**状态机**（清理缓存 / 清理历史记录）。
 *
 * [设置页七项改造·批 5] 原来这里有五个：选备份位置、选恢复来源、恢复策略三个随
 * 「活动库备份与恢复」一起下线（本地 zip 备份 + WebDAV 远端备份/上传/下载/删除全套都删了）。
 * 剩下的两个是**数据清理**，与本卡另外三组（导出导入 / 本机目录 / 清理）同一条命：
 * 清理缓存要重启并应用，所以必须二次确认；清理历史记录要先选档位。
 *
 * 状态与画分开的理由没变：`SettingsDataSafetyPanel` 只做组合，对话框层只画 JSX。
 */
interface Params {
  cleanupRange: CleanupRange;
  cleanupOptions: readonly { value: CleanupRange; label: string }[];
  onCleanupRangeChange: (value: CleanupRange) => void;
  isCleaning: boolean;
  onCleanup: () => void;
  onScheduleWebviewCacheClear: () => Promise<void> | void;
}

export function useSettingsDataSafetyDialogs({
  cleanupRange,
  cleanupOptions,
  onCleanupRangeChange,
  isCleaning,
  onCleanup,
  onScheduleWebviewCacheClear,
}: Params) {
  const UI_TEXT = useLocaleText();
  const cacheClearCancelRef = useRef<HTMLButtonElement>(null);

  const [cacheClearDialogOpen, setCacheClearDialogOpen] = useState(false);
  const [historyCleanupDialogOpen, setHistoryCleanupDialogOpen] = useState(false);

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

  return {
    UI_TEXT,
    isCleaning,
    refs: { cacheClearCancelRef },
    flags: {
      cacheClearDialogOpen,
      historyCleanupDialogOpen,
    },
    cleanupSliderOptions,
    cleanupRange,
    cleanupRangeIndex,
    selectedCleanupOption,
    updateCleanupRangeIndex,
    openHistoryCleanup: () => setHistoryCleanupDialogOpen(true),
    openCacheClear: () => setCacheClearDialogOpen(true),
    restartAndClearWebviewCacheFromDialog: () => {
      setCacheClearDialogOpen(false);
      void onScheduleWebviewCacheClear();
    },
    cleanupHistoryFromDialog: () => {
      setHistoryCleanupDialogOpen(false);
      onCleanup();
    },
    closeCacheClear: () => setCacheClearDialogOpen(false),
    closeHistoryCleanup: () => setHistoryCleanupDialogOpen(false),
  };
}

export type SettingsDataSafetyDialogsState = ReturnType<typeof useSettingsDataSafetyDialogs>;
