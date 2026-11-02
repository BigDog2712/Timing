/**
 * TickBar — 事项窗口表头（todos-panel.md §1 表头 32）
 * -----------------------------------------------------------------------------
 * 主「今日计时 · N」（12.5/600 --ink + · N 12.5/400 --ink-3）——「· N」的写法与
 * 「待办事项 · N」统一（V0.3.11 用户口径「今日计时后与待办事项后统一」），不再写「条」。
 * 副「X 小时 Y 分」（等宽 11.5 --ink-3，右对齐；不再加「共」字前缀）。这一列正好是
 * 待办行圆圈的列（用户口径「提醒放在显示总时间的部分」），两处右沿对齐。
 * 表头为窗口拖动区（K-2：capabilities 已放行 core:window:allow-start-dragging）。
 */
import { formatMinutes } from '../../lib/format';

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
        <span className="todos__head-count">· {recordCount}</span>
      </h2>
      <span className="todos__head-total">{formatMinutes(totalSec)}</span>
    </header>
  );
}
