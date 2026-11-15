import type { QuietToastTone } from "../../../shared/types/toast";
import type { UiText } from "../../../shared/i18n/index.ts";
import type { CleanupRange } from "../types.ts";

/**
 * 设置页「数据安全」卡里那几条**带副作用的动作编排**（[设置页七项改造·批 5] 大幅收窄）。
 *
 * 只剩「清理历史记录」一条：确认 → 清 → toast → reload。拆出来的理由是它需要
 * `confirm` / `notify` / `reload` 三个外部依赖，写在 hook 里会与状态机纠缠；
 * 而「备份导出 / 恢复准备 / 恢复提交」三条随活动库备份整块下线一起删掉了。
 *
 * 纯函数化（依赖通过 options 注入）让它能被单测直接跑，不必挂 React。
 */
interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
}

type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>;
type NotifyAction = (message: string, tone?: QuietToastTone) => void;
type BusyHook = () => void;
type ErrorReporter = (message: string, error: unknown) => void;

type CleanupFlowOptions = {
  uiText: UiText;
  cleanupRange: CleanupRange;
  cleanupRangeLabel: string;
  confirm: ConfirmAction;
  clearSessionsByRange: (range: CleanupRange) => Promise<void>;
  notify: NotifyAction;
  reload: () => void;
  onExecutionStart?: BusyHook;
  onExecutionEnd?: BusyHook;
  reportError?: ErrorReporter;
};

export async function runSettingsCleanupFlow(options: CleanupFlowOptions): Promise<boolean> {
  const UI_TEXT = options.uiText;
  const confirmed = await options.confirm({
    title: UI_TEXT.settings.cleanupConfirmTitle,
    description: UI_TEXT.settings.cleanupConfirmDetail(options.cleanupRangeLabel),
    confirmLabel: UI_TEXT.dialog.confirmDanger,
    danger: true,
  });
  if (!confirmed) {
    return false;
  }

  options.onExecutionStart?.();
  try {
    await options.clearSessionsByRange(options.cleanupRange);
    options.notify(UI_TEXT.toast.cleanupSuccess, "success");
    options.reload();
    return true;
  } catch (error) {
    options.reportError?.("cleanup failed", error);
    options.notify(UI_TEXT.toast.cleanupFailed, "error");
    return false;
  } finally {
    options.onExecutionEnd?.();
  }
}
