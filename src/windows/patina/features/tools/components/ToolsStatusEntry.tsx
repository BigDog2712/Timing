import { useEffect, useMemo, useState } from "react";
import { ToolCase } from "lucide-react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import { buildToolsViewModelLabels } from "../services/toolsLabels.ts";
import { toolsRuntimeSnapshotStore } from "../services/toolsRuntimeSnapshotStore.ts";
import { buildToolsStatusChipViewModels, earliestScheduledReminder } from "../services/toolsViewModel.ts";
import { startStatusClock } from "../services/toolStatusEntries.ts";
import type { ToolsOpenTarget } from "../types.ts";
import ToolStatusButtons from "./ToolStatusButtons.tsx";

interface ToolsStatusEntryProps {
  onOpenSection: (target: ToolsOpenTarget) => void;
  /** 工具面当前是否呈现 —— 只用来给入口门换底色（`data-tools-open`），不做导航判断。 */
  toolsOpen?: boolean;
}

export default function ToolsStatusEntry({
  onOpenSection,
  toolsOpen = false,
}: ToolsStatusEntryProps) {
  const uiText = useLocaleText();
  const [snapshot, setSnapshot] = useState<ToolsRuntimeSnapshot | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const labels = useMemo(() => buildToolsViewModelLabels(uiText), [uiText]);
  const reminder = useMemo(() => snapshot ? earliestScheduledReminder(snapshot) : null, [snapshot]);
  const due = reminder?.scheduledAt ?? null;
  const running = snapshot?.currentPomodoro?.status === "running"
    || Boolean(snapshot?.freeFocusTasks.some(task => task.status === "running"));

  useEffect(() => {
    if (running || due !== null) return startStatusClock(running, due, setNowMs);
  }, [running, due]);

  useEffect(() => {
    const unsubscribe = toolsRuntimeSnapshotStore.subscribe((nextSnapshot) => {
      setNowMs(Date.now());
      setSnapshot(nextSnapshot);
    });

    void toolsRuntimeSnapshotStore.refreshSnapshot()
      .catch((error) => {
        console.warn("load tools runtime snapshot failed", error);
      });

    return unsubscribe;
  }, []);

  const statusChips = useMemo(() => (
    snapshot
      ? buildToolsStatusChipViewModels(snapshot, nowMs, labels, reminder)
      : []
  ), [labels, nowMs, snapshot, reminder]);

  /* 空态兜底：只有「快照已到、且没有任何提醒/计时」才放门。快照未到时放门，会在每次
   * 窗口唤醒时先闪一下门再被灯替换（有提醒的用户每次都看到这个抖动）。
   * 门点击后进工具面、不带 section —— 落回工具面自己记住的分区。 */
  const emptyEntry = snapshot ? (
    <button
      type="button"
      className="qp-topbar-tools-door"
      data-titlebar-tools-door=""
      data-tools-open={toolsOpen ? "true" : "false"}
      aria-label={uiText.tools.title}
      onClick={() => onOpenSection({})}
    >
      <ToolCase size={16} strokeWidth={2.4} aria-hidden="true" />
    </button>
  ) : undefined;

  return <ToolStatusButtons entries={statusChips} onOpenSection={onOpenSection} emptyEntry={emptyEntry} />;
}
