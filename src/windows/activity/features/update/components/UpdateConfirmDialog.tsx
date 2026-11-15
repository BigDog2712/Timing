import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { useRef } from "react";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietButton, { type QuietButtonTone } from "../../../shared/components/QuietButton";
import type { UpdateSnapshot } from "../../../shared/types/update";
import {
  buildUpdateConfirmDialogModel, type UpdateActionModel, } from "../services/updateViewModel";
import UpdateProgressBar from "./UpdateProgressBar";


interface UpdateConfirmDialogProps {
  open: boolean;
  snapshot: UpdateSnapshot;
  installing: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRetryCheck: () => void;
  onOpenReleasePage: () => void;
  onOpenAssetDownload: () => void;
}

function resolveButtonTone(action: UpdateActionModel): QuietButtonTone {
  return action.emphasis === "secondary" ? "secondary" : "primary";
}

export default function UpdateConfirmDialog({
  open,
  snapshot,
  installing,
  onClose,
  onConfirm,
  onRetryCheck,
  onOpenReleasePage,
  onOpenAssetDownload,
}: UpdateConfirmDialogProps) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const laterButtonRef = useRef<HTMLButtonElement>(null);
  const viewModel = buildUpdateConfirmDialogModel(snapshot, UI_TEXT, locale);

  const handleAction = (action: UpdateActionModel | null) => {
    if (!action || action.disabled) return;
    switch (action.action) {
      case "open_confirm":
        onConfirm();
        return;
      case "check":
        onRetryCheck();
        return;
      case "open_release_page":
        onOpenReleasePage();
        return;
      case "open_download_url":
        onOpenAssetDownload();
    }
  };

  return (
    <QuietDialog
      open={open}
      title={viewModel.title}
      onClose={onClose}
      initialFocusRef={laterButtonRef}
      actions={(
        <>
          <QuietButton
            ref={laterButtonRef}
            size="large"
            onClick={onClose}
            className="at-dialog-action"
          >
            {UI_TEXT.update.later}
          </QuietButton>
          {viewModel.secondaryAction ? (
            <QuietButton
              tone={resolveButtonTone(viewModel.secondaryAction)}
              size="large"
              onClick={() => handleAction(viewModel.secondaryAction)}
              disabled={viewModel.secondaryAction.disabled}
              className="at-dialog-action"
            >
              {viewModel.secondaryAction.label}
            </QuietButton>
          ) : null}
          {viewModel.primaryAction ? (
            <QuietButton
              tone={resolveButtonTone(viewModel.primaryAction)}
              size="large"
              onClick={() => handleAction(viewModel.primaryAction)}
              disabled={installing || viewModel.primaryAction.disabled}
              busy={installing && viewModel.primaryAction.action === "open_confirm"}
              className="at-dialog-action"
            >
              {installing && viewModel.primaryAction.action === "open_confirm"
                ? UI_TEXT.update.processing
                : viewModel.primaryAction.label}
            </QuietButton>
          ) : null}
        </>
      )}
    >
      <div className="space-y-3">
        <p className="at-text-body at-weight-emphasis text-[var(--at-text-primary)]">{viewModel.versionCompareLabel}</p>
        <p className="at-text-body leading-relaxed text-[var(--at-text-secondary)]">{viewModel.confirmDescription}</p>
        {viewModel.progress ? (
          <UpdateProgressBar
            percent={viewModel.progress.percent}
            label={viewModel.progress.label}
            valueText={viewModel.progress.valueText}
            indeterminate={viewModel.progress.indeterminate}
          />
        ) : null}
        {viewModel.notesPreview ? (
          <div className="at-subpanel">
            <p className="at-text-caption at-weight-emphasis text-[var(--at-text-tertiary)]">{UI_TEXT.update.releaseNotes}</p>
            <p
              className="mt-1 break-words at-text-caption leading-relaxed text-[var(--at-text-tertiary)]"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {viewModel.notesPreview}
            </p>
          </div>
        ) : null}
      </div>
    </QuietDialog>
  );
}
