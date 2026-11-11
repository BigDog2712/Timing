import type { ReactNode } from "react";
import { AlarmClock, BellRing } from "lucide-react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToolStatusChipViewModel, ToolsOpenTarget } from "../types.ts";
import ToolsStatusChip from "./ToolsStatusChip.tsx";

export default function ToolStatusButtons({ entries, onOpenSection, emptyEntry }: {
  entries: ToolStatusChipViewModel[];
  onOpenSection: (target: ToolsOpenTarget) => void;
  /** 空态兜底内容：主窗顶栏传「工具入口门」（§5.3）。mini 窗**不传** →
   *  保持旧的「没有条目就什么都不渲染」语义（mini 标题栏宽度是硬预算）。 */
  emptyEntry?: ReactNode;
}) {
  const text = useLocaleText();
  if (entries.length) return <div className="tools-status-entry-titlebar" data-titlebar-tools-status="" role="group" aria-label={text.tools.title}>
    {entries.map(entry => <ToolsStatusChip key={entry.targetSection} label={entry.label}
      icon={entry.targetSection === "pomodoro" ? AlarmClock : BellRing}
      onClick={() => onOpenSection({ section: entry.targetSection })}
      className="tools-status-entry-titlebar-item" iconOnly tooltipPlacement="bottom" />)}
  </div>;
  /* 门与灯共槽、不同时出现：条目非空时上面已 return —— 两者永远不会并排 */
  if (!emptyEntry) return null;
  return <div className="tools-status-entry-titlebar" data-titlebar-tools-status="">{emptyEntry}</div>;
}
