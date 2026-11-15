/**
 * 「导出完整数据包」这一行（[批 2 · 第 5 项]）。
 *
 * **自带状态**：选落点 → 导出 → 把「多少行 / 多大」直接写在行下面。
 * 为什么不复用页面的 `busy` / toast：导出是**只读**动作，失败既不该锁住整页表单，
 * 也不该让用户去别处找一句一闪而过的提示；结果留在原地，用户想看一眼随时能看。
 *
 * 选文件取消（返回 `null`）要**原样返回、不报错**：那是用户改主意，不是失败。
 */
import { useCallback, useState } from "react";
import QuietButton from "../../../shared/components/QuietButton";
import {
  exportFullBundle,
  pickFullBundleSaveFile,
} from "../../../platform/persistence/fullBundleRuntimeGateway.ts";
import { SettingsPreferenceRow } from "./SettingsPreferenceLayout";
import {
  FULL_BUNDLE_EXPORT_ACTION,
  FULL_BUNDLE_EXPORT_HINT,
  FULL_BUNDLE_EXPORTING,
  FULL_BUNDLE_TITLE,
  fullBundleExportFailed,
  fullBundleExported,
} from "./fullBundleCopy.ts";

export default function SettingsFullBundleExportRow({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const handleExport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const target = await pickFullBundleSaveFile();
      if (!target) return;
      const summary = await exportFullBundle(target);
      setFailed(false);
      setStatus(fullBundleExported(summary.rowCount, summary.bytes));
    } catch (error) {
      setFailed(true);
      setStatus(fullBundleExportFailed(String(error)));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <>
      <SettingsPreferenceRow title={FULL_BUNDLE_TITLE} hint={FULL_BUNDLE_EXPORT_HINT}>
        <QuietButton
          size="compact"
          busy={busy}
          disabled={disabled || busy}
          onClick={() => { void handleExport(); }}
        >
          {busy ? FULL_BUNDLE_EXPORTING : FULL_BUNDLE_EXPORT_ACTION}
        </QuietButton>
      </SettingsPreferenceRow>
      {status ? (
        <p
          className={`at-text-caption ${failed ? "text-[var(--at-danger)]" : "text-[var(--at-text-tertiary)]"}`}
          role={failed ? "alert" : "status"}
        >
          {status}
        </p>
      ) : null}
    </>
  );
}
