import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { PencilLine, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";

import { useLocale, useLocaleText } from "../../../../shared/i18n/index.ts";
import QuietButton from "../../../../shared/components/QuietButton.tsx";
import QuietIconAction from "../../../../shared/components/QuietIconAction.tsx";
import { DASHBOARD_COPY } from "../../copy.ts";
import ModuleShell from "../ModuleShell.tsx";
import { useActivityReminders } from "../../hooks/useActivityReminders.ts";
import type { ActivityReminderRuleRowViewModel } from "../../../tools/types.ts";
import {
  buildActivityReminderTargetOptions,
  findActivityReminderRuleForTarget,
  findActivityReminderTargetOption,
} from "../../../tools/services/activityReminderTargetOptions.ts";
import ActivityReminderDurationPicker from "./ActivityReminderDurationPicker.tsx";
import ActivityReminderRuleEditor from "./ActivityReminderRuleEditor.tsx";
import ActivityReminderTargetPicker from "./ActivityReminderTargetPicker.tsx";

/**
 * [本轮 T04] 活动提醒卡 —— 工具页「活动提醒」分区的卡内形态。
 * -----------------------------------------------------------------------------
 * 创建（目标 + 阈值）/ 开关规则 / 改阈值 / 删除（= 禁用）四件事全在卡内完成；
 * 到点的**弹窗**仍是保留在 `features/tools/` 的 `ToolAlertDialog`（挂在 `AppShell`），
 * 本卡只管「规则长什么样」，不碰投递链（Q4：`tool-notification` 一个字节不动）。
 *
 * 复用三件套（`ActivityReminderRuleEditor` / `-DurationPicker` / `-TargetPicker`，
 * 已按附录第 4 条**搬迁**到本目录）与 `tools-alerts.css` 里保留下来的表单/行样式；
 * 卡级布局差异（列表滚动上限）在 `dashboard-r2.css` 的 T04 段。
 *
 * 分层纪律：本文件不触碰传输层（L1 是按字面 grep 的判据，注释里也不出现那个调用词），
 * 写动作一律经 `useActivityReminders` → `platform/runtime/toolsRuntimeGateway`。
 */
interface Props {
  /** 卡头 `⋯`（布局层注入） */
  controls?: ReactNode;
  /** 目标候选里应用行的图标表（与时间线/应用卡同源） */
  icons: Record<string, string>;
}

interface ReminderDraft {
  targetValue: string;
  durationMinutes: number;
  validationMessage: string | null;
}

const EMPTY_DRAFT: ReminderDraft = {
  targetValue: "",
  durationMinutes: 30,
  validationMessage: null,
};

const ACTIVITY_TARGET_KINDS = ["app", "category", "web"] as const;

function appInitial(label: string) {
  return label.trim().slice(0, 1).toUpperCase() || "?";
}

function resolveAppIcon(icons: Record<string, string>, exeName: string | null) {
  if (!exeName) return null;
  return icons[exeName] ?? icons[exeName.toLocaleLowerCase()] ?? null;
}

function ReminderRowActions({ label, enabled, busy, onToggle, onEdit, onDelete }: {
  label: string;
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const text = useLocaleText();
  return <div className="tools-reminder-row-actions">
    <QuietIconAction icon={enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
      title={enabled ? text.tools.activityReminderDisable : text.tools.activityReminderActive}
      ariaLabel={`${text.tools.activityReminderActive}: ${label}`} pressed={enabled}
      showPressedStyle={false} busy={busy} onClick={onToggle} />
    <QuietIconAction icon={<PencilLine size={16} />} title={text.tools.activityReminderEdit}
      ariaLabel={`${text.tools.activityReminderEdit}: ${label}`} busy={busy} onClick={onEdit} />
    <QuietIconAction icon={<Trash2 size={16} />} title={text.tools.activityReminderDelete} tone="danger"
      ariaLabel={`${text.tools.activityReminderDelete}: ${label}`} busy={busy} onClick={onDelete} />
  </div>;
}

export default function ReminderModule({ controls, icons }: Props) {
  const locale = useLocale();
  const copy = DASHBOARD_COPY[locale];
  const UI_TEXT = useLocaleText();
  const reminders = useActivityReminders();
  const [draft, setDraft] = useState<ReminderDraft>({ ...EMPTY_DRAFT });
  const [editingRule, setEditingRule] = useState<ActivityReminderRuleRowViewModel | null>(null);
  const { targetValue, durationMinutes, validationMessage } = draft;
  const updateDraft = (patch: Partial<ReminderDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const targetOptions = useMemo(
    () => buildActivityReminderTargetOptions(
      reminders.appCandidates, reminders.categoryCandidates, reminders.webCandidates, icons,
    ),
    [icons, reminders.appCandidates, reminders.categoryCandidates, reminders.webCandidates],
  );
  const selectedTarget = findActivityReminderTargetOption(targetValue, targetOptions);
  const existingRule = selectedTarget
    ? findActivityReminderRuleForTarget(selectedTarget.target, reminders.ruleRows)
    : undefined;
  const creating = reminders.busyAction === "create-activity-reminder";

  const renderRuleIcon = (row: ActivityReminderRuleRowViewModel, label = row.targetLabel) => {
    const option = findActivityReminderTargetOption(`${row.kind}:${row.targetKey}`, targetOptions);
    const icon = row.kind === "app" ? resolveAppIcon(icons, row.exeName) : option?.iconUrl;
    return <span className="data-app-option-icon" aria-hidden
      style={option?.accentColor ? { "--activity-category-color": option.accentColor } as CSSProperties : undefined}>
      {row.kind === "category" ? <span className="tools-activity-category-dot" />
        : icon ? <img src={icon} alt="" draggable={false} /> : appInitial(label)}
    </span>;
  };
  const typeLabels = {
    app: UI_TEXT.tools.reminderModeApp,
    category: UI_TEXT.tools.reminderModeCategory,
    web: UI_TEXT.tools.reminderModeWeb,
  };

  const handleCreate = async () => {
    if (!selectedTarget) {
      updateDraft({ validationMessage: UI_TEXT.tools.activityReminderTargetRequired });
      return;
    }
    updateDraft({ validationMessage: null });
    /* 同一目标已有规则 → 打开它的阈值编辑弹层，而不是再建一条（与旧分区同口径） */
    if (existingRule) {
      setEditingRule({ ...existingRule, targetLabel: selectedTarget.label });
      return;
    }
    const created = await reminders.createRule(selectedTarget.target, selectedTarget.label, durationMinutes, "");
    if (created) updateDraft({ targetValue: "", validationMessage: null });
  };

  return (
    <ModuleShell
      id="t-reminder"
      title={copy.cardLabels.reminder ?? ""}
      state={reminders.loadError ? "error" : "ready"}
      emptyText={copy.reminderEmpty}
      errorText={UI_TEXT.common.readFailed}
      retryLabel={UI_TEXT.common.retry}
      onRetry={reminders.retryLoad}
      controls={controls}
    >
      <div className="tools-reminder-form tools-software-reminder-form qp-reminder-form">
        <div className="tools-form-field">
          <span>{UI_TEXT.tools.activityReminderTargetLabel}</span>
          <ActivityReminderTargetPicker
            value={targetValue}
            appCandidates={reminders.appCandidates}
            categoryCandidates={reminders.categoryCandidates}
            webCandidates={reminders.webCandidates}
            icons={icons}
            placeholder={UI_TEXT.tools.activityReminderTargetPlaceholder}
            ariaLabel={UI_TEXT.tools.activityReminderTargetPlaceholder}
            onChange={(value) => updateDraft({ targetValue: value, validationMessage: null })}
          />
        </div>
        {ACTIVITY_TARGET_KINDS.filter((kind) => reminders.candidateLoadState[kind] === "error").map((kind) => (
          <div key={kind} className="tools-candidate-load-error" role="status">
            <span>{typeLabels[kind]} · {UI_TEXT.tools.activityReminderCandidatesLoadFailed}</span>
            <QuietButton size="compact" onClick={() => reminders.retryCandidates(kind)}>
              {UI_TEXT.common.retry}
            </QuietButton>
          </div>
        ))}
        <div className="tools-form-field">
          <span>{UI_TEXT.tools.activityReminderDurationLabel}</span>
          <ActivityReminderDurationPicker
            minutes={existingRule?.limitMinutes ?? durationMinutes}
            disabled={creating || Boolean(existingRule)}
            onChange={(minutes) => updateDraft({ durationMinutes: minutes, validationMessage: null })}
          />
        </div>
        <div className="tools-form-actions tools-software-form-actions">
          <QuietButton
            tone="primary"
            size="compact"
            disabled={reminders.busyAction !== null}
            onClick={() => void handleCreate()}
            aria-label={existingRule ? `${UI_TEXT.tools.activityReminderEdit}: ${selectedTarget?.label}` : UI_TEXT.accessibility.tools.createReminder}
            busy={creating}
            className="tools-action-button"
          >
            {existingRule ? UI_TEXT.tools.activityReminderEdit : UI_TEXT.tools.createReminder}
          </QuietButton>
        </div>
        {validationMessage ? <p className="tools-validation-message">{validationMessage}</p> : null}
        {reminders.actionError ? <p className="tools-validation-message" role="alert">{reminders.actionError}</p> : null}
      </div>

      {reminders.ruleRows.length === 0 ? (
        <div className="tools-empty-state">{copy.reminderEmpty}</div>
      ) : (
        <div className="tools-reminder-list-frame">
          <div className="tools-reminder-list qp-scroll-region qp-scroll-region-stable">
            {reminders.ruleRows.map((row) => {
              const busy = reminders.busyAction !== null;
              const webCandidate = row.kind === "web"
                ? reminders.webCandidates.find((candidate) => candidate.normalizedDomain === row.targetKey)
                : null;
              const category = row.kind === "category"
                ? reminders.categoryCandidates.find((candidate) => candidate.categoryId === row.targetKey)
                : null;
              const appCandidate = row.kind === "app"
                ? reminders.appCandidates.find((candidate) => candidate.exeName === row.targetKey)
                : null;
              const currentLabel = appCandidate?.appName
                ?? category?.label
                ?? webCandidate?.label
                ?? row.targetLabel;
              return (
                <div key={row.id} className="tools-reminder-row" data-activity-rule-kind={row.kind} data-activity-rule-enabled={row.enabled}>
                  <div className="tools-reminder-row-main tools-software-rule-main">
                    {renderRuleIcon(row, currentLabel)}
                    <div className="tools-software-rule-copy">
                      <div className="tools-software-rule-heading">
                        <strong>{currentLabel}</strong>
                        <span className="tools-tabular">{row.limitLabel}</span>
                      </div>
                      {row.suspensionReason ? <span>{UI_TEXT.tools.activityReminderSuspension[row.suspensionReason]}</span>
                        : row.message ? <span>{row.message}</span> : null}
                    </div>
                  </div>
                  <ReminderRowActions label={currentLabel} enabled={row.enabled} busy={busy}
                    onToggle={() => void reminders.setRuleEnabled(row.id, !row.enabled)}
                    onEdit={() => setEditingRule({ ...row, targetLabel: currentLabel })}
                    onDelete={() => void reminders.disableRule(row.id)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {editingRule ? <ActivityReminderRuleEditor rule={editingRule}
        targetIcon={renderRuleIcon(editingRule)}
        busy={reminders.busyAction !== null}
        onSave={reminders.updateLimit}
        onClose={() => setEditingRule(null)} /> : null}
    </ModuleShell>
  );
}
