import { useEffect, useRef, type FormEvent } from "react";

import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";

/**
 * 快捷分类弹层里那个「改名」对话框（从 `QuickClassificationSurface` 原样搬出来的）。
 *
 * 搬家的理由只有一个：0.12.1 给同一个弹层加了「绑定事项」那一栏之后，
 * Surface 会顶穿单文件 300 行上限（`npm run check:size` 是逐文件棘轮，不许新增豁免）。
 * 行为、类名、表单 id、焦点与文案**一个字没改** —— 它仍然是那个只有一行输入框的弹窗。
 *
 * 「有没有改动」的判据也一起搬过来（原来在 Surface 里算）：
 *   · 已经起过自定义名 → 与自定义名比；
 *   · 还没有自定义名 → 与目标原名比，且**清空不算改动**（清空等于回到原名，不产生写）。
 */
interface Props {
  open: boolean;
  saving: boolean;
  /** 输入框当前值（受控） */
  value: string;
  /** 已有的自定义名（没有则空串） */
  currentDisplayName: string;
  /** 目标原名（`target.displayName`） */
  fallbackName: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function QuickClassificationRenameDialog({
  open,
  saving,
  value,
  currentDisplayName,
  fallbackName,
  onChange,
  onSubmit,
  onClose,
}: Props) {
  const UI_TEXT = useLocaleText();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const normalizedValue = value.trim();
  const hasChanges = currentDisplayName
    ? normalizedValue !== currentDisplayName
    : normalizedValue !== fallbackName.trim() && normalizedValue !== "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving || !hasChanges) return;
    onSubmit();
  };

  return (
    <QuietDialog
      open={open}
      title={UI_TEXT.mapping.quickRenameTitle}
      surfaceClassName="quick-classification-rename-dialog"
      initialFocusRef={inputRef}
      onClose={() => {
        if (!saving) onClose();
      }}
      actions={(
        <>
          <QuietButton tone="secondary" onClick={() => onClose()} disabled={saving}>
            {UI_TEXT.dialog.cancel}
          </QuietButton>
          <QuietButton
            tone="primary"
            type="submit"
            form="quick-classification-rename-form"
            disabled={saving || !hasChanges}
          >
            {saving ? UI_TEXT.mapping.quickSaving : UI_TEXT.mapping.quickSave}
          </QuietButton>
        </>
      )}
    >
      <form id="quick-classification-rename-form" className="quick-classification-rename-form" onSubmit={submit}>
        <input
          ref={inputRef}
          className="qp-control qp-dialog-input quick-classification-rename-input"
          value={value}
          placeholder={UI_TEXT.mapping.quickRenamePlaceholder}
          disabled={saving}
          maxLength={80}
          onChange={(event) => onChange(event.target.value)}
        />
      </form>
    </QuietDialog>
  );
}
