/**
 * TickBar — 抓取柄 GripHandle（V0.2.0 对齐 Timing：自绘圆角括号 `）`）
 * -----------------------------------------------------------------------------
 * 规格（DESIGN-V0.2.0.md §5.3 / pill-bar.md §1）：viewBox 12×22、stroke 2.5（Timing 实绘 Pen 宽 2.5，MainForm.cs:2251），
 * 路径 M5.6 3.6 C9 6.6, 9 15.4, 5.6 18.4；**仅 hover 显示**（opacity 0 → 1，--dur-exit）。
 * 非 lucide 图标（形态符号，非功能图标）；触发药丸 <-> 收起圆点形态变形（--dur-morph）。
 */
interface GripHandleProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function CollapseHandle({ collapsed, onToggle }: GripHandleProps) {
  return (
    <button
      type="button"
      className="pill__handle"
      onClick={onToggle}
      aria-label={collapsed ? '展开药丸' : '收起为圆点'}
      aria-expanded={!collapsed}
    >
      <svg
        width="12"
        height="22"
        viewBox="0 0 12 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M5.6 3.6 C9 6.6, 9 15.4, 5.6 18.4" />
      </svg>
    </button>
  );
}
