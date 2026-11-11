import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import QuietPageHeader from "../../../shared/components/QuietPageHeader.tsx";

/**
 * 区间模式下的页头：标题 + 档位条 + 范围标签。
 *
 * 为什么不复用 `HistoryDateHeader`：那边整套状态（日历弹窗、前后翻日、读失败条）
 * 都围着"某一天"转，区间模式一个都用不上；塞一堆 dummy handler 进去比多一个 40 行的
 * 组件更容易出 bug。两边的**标题与图标走同一处文案与同一个组件**，所以不会漂。
 */
interface Props {
  title: string;
  rangeLabel: string;
  rangeBar: ReactNode;
}

export default function HistoryRangeHeader({ title, rangeLabel, rangeBar }: Props) {
  return (
    <QuietPageHeader
      icon={<Clock size={18} />}
      title={title}
      rightSlot={(
        <div className="flex items-center gap-2 shrink-0">
          {rangeBar}
          <span className="qp-status history-date-label relative inline-flex min-w-[102px] cursor-default items-center justify-center px-3 py-[5px] text-center text-[var(--qp-text-secondary)]">
            {rangeLabel}
          </span>
        </div>
      )}
    />
  );
}
