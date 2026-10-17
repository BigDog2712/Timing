/**
 * TickBar — 事项窗口表头（todos-panel.md §1 表头 32）
 * -----------------------------------------------------------------------------
 * 主「今日计时 · N 条」（12.5/600 --ink + · N 条 12.5/400 --ink-3）
 * 副「共 X 小时 Y 分」（等宽 11.5 --ink-3，右对齐）。
 * 表头为窗口拖动区（K-2：capabilities 已放行 core:window:allow-start-dragging）。
 */
import { formatHoursMinutes } from '../../lib/format';

interface TodosHeaderProps {
  /** 今日计时行数（已保存记录 + 进行中会话） */
  recordCount: number;
  /** 今日合计秒数（已保存 + 进行中实时） */
  totalSec: number;
}

export function TodosHeader({ recordCount, totalSec }: TodosHeaderProps) {
  return (
    <header className="todos__head" data-tauri-drag-region>
      <h2 className="todos__head-title">
        今日计时
        <span className="todos__head-count">· {recordCount} 条</span>
      </h2>
      <span className="todos__head-total">共 {formatHoursMinutes(totalSec)}</span>
    </header>
  );
}
