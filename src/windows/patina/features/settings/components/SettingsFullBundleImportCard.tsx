/**
 * 「完整数据包」导入路径（[批 2 · 第 5 项]）：卡片 + 预览/结果对话框，**自带状态**。
 *
 * 为什么不去动 `useSettingsImportState` 那台状态机：CSV 导入是「预览 → 分类映射 →
 * 提交」三段，而完整数据包只有「预览 → 合并」两段，硬塞进同一台状态机只会让两边
 * 的分支互相污染。这里单独一份，`SettingsDataImportDialog` 只负责把它摆到操作列表里。
 *
 * 三道闸：
 * 1. **只读预览**：选完文件先 `inspect`，确认之前一个字节都不写库。
 * 2. **不兼容不放行**：`compatible === false` 时确认键根本不渲染（不是 disabled——
 *    灰键仍可聚焦，读屏用户会以为能点）。
 * 3. **结果按表报**：新增 / 更新 / 跳过逐表列出，用户能看到「跳过了多少」而不是一个总数。
 */
import { CircleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import QuietActionRow from "../../../shared/components/QuietActionRow.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietTooltip from "../../../shared/components/QuietTooltip.tsx";
import {
  importFullBundle,
  inspectFullBundle,
  pickFullBundleFile,
  type FullBundleImportSummary,
  type FullBundleInspect,
} from "../../../platform/persistence/fullBundleRuntimeGateway.ts";
import {
  FULL_BUNDLE_IMPORT_ACTION,
  FULL_BUNDLE_IMPORT_DIALOG_TITLE,
  FULL_BUNDLE_IMPORT_HINT,
  FULL_BUNDLE_IMPORTING,
  FULL_BUNDLE_IMPORT_RESULT_TITLE,
  FULL_BUNDLE_INCOMPATIBLE_NOTE,
  FULL_BUNDLE_RESTART_NOTE,
  FULL_BUNDLE_RULE_LABEL,
  FULL_BUNDLE_RULE_TEXT,
  FULL_BUNDLE_TITLE,
  fullBundleImported,
  fullBundleSourceLine,
  fullBundleTableRow,
} from "./fullBundleCopy.ts";

interface Props {
  disabled?: boolean;
  /** 导入成功后让上层刷新（沿用现有的 `onImportedDataChanged`）。 */
  onImported?: () => void;
}

type Phase = "closed" | "preview" | "result";

export default function SettingsFullBundleImportCard({ disabled = false, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState<FullBundleInspect | null>(null);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [result, setResult] = useState<FullBundleImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    setPhase("closed");
    setInspect(null);
    setBundlePath(null);
    setResult(null);
    setError(null);
  }, [busy]);

  const choose = useCallback(async () => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await pickFullBundleFile();
      /* 取消选文件 = 用户改主意，不是失败：安静返回。 */
      if (!picked) return;
      const preview = await inspectFullBundle(picked);
      setBundlePath(picked);
      setInspect(preview);
      setResult(null);
      setPhase("preview");
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }, [busy, disabled]);

  const confirm = useCallback(async () => {
    if (busy || !bundlePath || !inspect?.compatible) return;
    setBusy(true);
    setError(null);
    try {
      const summary = await importFullBundle(bundlePath);
      setResult(summary);
      setPhase("result");
      onImported?.();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }, [bundlePath, busy, inspect, onImported]);

  const locked = disabled || busy;

  return (
    <>
      <QuietActionRow className="settings-dialog-action-card">
        <div className="settings-dialog-action-composite" data-disabled={locked ? "true" : undefined}>
          <button
            type="button"
            aria-label={FULL_BUNDLE_TITLE}
            disabled={locked}
            className="settings-dialog-action-hit-target"
            onClick={() => { void choose(); }}
          />
          <div className="settings-dialog-action-copy">
            <div className="settings-import-action-heading">
              <p className="settings-import-action-title qp-text-body qp-weight-medium text-[var(--qp-text-primary)]">
                {FULL_BUNDLE_TITLE}
              </p>
              <QuietTooltip
                label={FULL_BUNDLE_IMPORT_HINT}
                placement="top"
                tooltipClassName="settings-help-tooltip"
                hideOnPointerDown={false}
              >
                <button type="button" className="settings-help-icon" aria-label={FULL_BUNDLE_IMPORT_HINT}>
                  <CircleAlert size={13} aria-hidden="true" />
                </button>
              </QuietTooltip>
            </div>
          </div>
        </div>
      </QuietActionRow>

      <QuietDialog
        open={phase !== "closed"}
        title={phase === "result" ? FULL_BUNDLE_IMPORT_RESULT_TITLE : FULL_BUNDLE_IMPORT_DIALOG_TITLE}
        onClose={close}
        closeOnBackdrop={!busy}
        surfaceClassName="settings-data-action-dialog"
        actions={phase === "result" ? (
          <QuietButton onClick={close}>关闭</QuietButton>
        ) : (
          <>
            <QuietButton disabled={busy} onClick={close}>取消</QuietButton>
            {inspect?.compatible ? (
              <QuietButton tone="primary" busy={busy} onClick={() => { void confirm(); }}>
                {busy ? FULL_BUNDLE_IMPORTING : FULL_BUNDLE_IMPORT_ACTION}
              </QuietButton>
            ) : null}
          </>
        )}
      >
        {error ? (
          <p className="qp-text-caption text-[var(--qp-danger)]" role="alert">{error}</p>
        ) : null}

        {phase === "preview" && inspect ? (
          <div className="settings-import-preview">
            <dl className="settings-import-preview-detail-group">
              <div><dt>来源</dt><dd>{fullBundleSourceLine(inspect)}</dd></div>
              <div><dt>合计</dt><dd>{inspect.message}</dd></div>
            </dl>
            <p className="qp-text-caption text-[var(--qp-text-tertiary)]">
              {FULL_BUNDLE_RULE_LABEL}：{FULL_BUNDLE_RULE_TEXT}
            </p>
            {inspect.compatible ? null : (
              <p className="qp-text-caption text-[var(--qp-danger)]" role="alert">
                {FULL_BUNDLE_INCOMPATIBLE_NOTE}
              </p>
            )}
            <ul className="qp-scroll-region qp-text-caption">
              {inspect.tables.filter((table) => table.rows > 0).map((table) => (
                <li key={table.name}>{table.name} · {table.rows} 行</li>
              ))}
            </ul>
            <p className="qp-text-caption text-[var(--qp-text-tertiary)]">{FULL_BUNDLE_RESTART_NOTE}</p>
          </div>
        ) : null}

        {phase === "result" && result ? (
          <div className="settings-import-preview">
            <p className="qp-text-body qp-weight-medium">
              {fullBundleImported(result.totalInserted, result.totalUpdated)}
            </p>
            <ul className="qp-scroll-region qp-text-caption">
              {result.tables
                .filter((stat) => stat.inserted + stat.updated + stat.skipped > 0)
                .map((stat) => (
                  <li key={stat.name}>{stat.name} · {fullBundleTableRow(stat)}</li>
                ))}
            </ul>
            <p className="qp-text-caption text-[var(--qp-text-tertiary)]">{FULL_BUNDLE_RESTART_NOTE}</p>
          </div>
        ) : null}
      </QuietDialog>
    </>
  );
}
