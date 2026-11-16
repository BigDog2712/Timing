/**
 * md 覆盖提醒的裁决弹窗（[T03]）
 * -----------------------------------------------------------------------------
 * 后端在前台同步检测到 `file_changed`（正文 trim 判据，不用 mtime）后，不再静默
 * 「Markdown 赢」，而是按冲突状态分派：前台 → `awaiting_decision`（本弹窗），后台 →
 * `pending_decision`（挂起）。用户对每一个待裁决冲突选：
 *   A「覆盖 Timing」→ `overwrite_timing`（md → SQL）
 *   B「保留 Timing」→ `keep_timing`（SQL → md）
 *   C「暂不处理」  → `deferred`（回挂起，不静默改写任一端）
 * 每次选择后端都会 append 到 `md_decision_audit`（只 append，不读回改后续默认行为）。
 *
 * 数据源两条，取并集、都只认 `awaiting_decision`：
 *   1. `md-sync:decision-required` 事件：前台同步后广播（`announce_decisions`）；
 *   2. 挂载时 `md_sync_decisions()`：用户重新进入设置页时，把上一轮已提升但还没
 *      裁决的冲突再捞出来，弹窗不至于「关了一次就再也找不回」。
 *
 * 关闭（ESC / 点背景）只是**本地收起**，不清后端注册表：那些冲突仍是 `awaiting`，
 * 下次事件 / 重新进入设置页还会再弹。
 */
import { useEffect, useState } from "react";

import QuietButton from "../../../../shared/components/QuietButton";
import QuietDialog from "../../../../shared/components/QuietDialog";
import { errorText, mdSyncApi } from "../../services/hostApi";
import { MD_SYNC_DECISION_REQUIRED_EVENT, useHostEvent } from "../../services/host/hostEvents";
import { MD_SYNC_KIND_LABELS } from "../../services/host/hostTypes";
import type { Decision, MdPendingConflict } from "../../services/host/hostTypes";

const AWAITING = "awaiting_decision";

export function MdSyncDecisionDialog() {
  const [conflicts, setConflicts] = useState<MdPendingConflict[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* 前台同步后广播的待裁决列表：替换（不是追加），后端已经聚合好一轮多区块改动。 */
  useHostEvent<MdPendingConflict[]>(MD_SYNC_DECISION_REQUIRED_EVENT, (list) => {
    const awaiting = (list ?? []).filter((item) => item.state === AWAITING);
    if (awaiting.length > 0) {
      setConflicts(awaiting);
      setError(null);
    }
  });

  /* 重新进入设置页时，把「已提升但还没裁决」的冲突再捞出来。 */
  useEffect(() => {
    let cancelled = false;
    void mdSyncApi
      .decisions()
      .then((list) => {
        if (cancelled) return;
        const awaiting = list.filter((item) => item.state === AWAITING);
        if (awaiting.length > 0) setConflicts(awaiting);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const resolve = async (id: string, decision: Decision): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await mdSyncApi.resolve(id, decision);
      setConflicts((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <QuietDialog
      open={conflicts.length > 0}
      title="Markdown 与 Timing 内容不一致"
      description="检测到 Markdown 文件有改动，请选择以哪一侧为准。每次选择都会记入同步审计。"
      onClose={() => setConflicts([])}
      closeOnBackdrop={!busy}
      surfaceClassName="md-sync-decision-dialog"
    >
      <div className="md-sync-decision-list">
        {conflicts.map((conflict) => (
          <div key={conflict.id} className="md-sync-decision-row">
            <div className="md-sync-decision-meta">
              <span className="md-sync-decision-kind">
                {MD_SYNC_KIND_LABELS[conflict.kind]}
              </span>
              <span className="md-sync-decision-heading">{conflict.heading}</span>
              <span className="md-sync-decision-path" title={conflict.path}>
                {conflict.path}
              </span>
            </div>
            <div className="md-sync-decision-actions">
              <QuietButton
                tone="primary"
                size="compact"
                disabled={busy}
                onClick={() => void resolve(conflict.id, "overwrite_timing")}
              >
                覆盖 Timing
              </QuietButton>
              <QuietButton
                size="compact"
                disabled={busy}
                onClick={() => void resolve(conflict.id, "keep_timing")}
              >
                保留 Timing
              </QuietButton>
              <QuietButton
                size="compact"
                disabled={busy}
                onClick={() => void resolve(conflict.id, "deferred")}
              >
                暂不处理
              </QuietButton>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="md-sync-decision-error">{error}</p>}
    </QuietDialog>
  );
}
