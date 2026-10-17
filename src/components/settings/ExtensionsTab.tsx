/**
 * TickBar — 设置 · 扩展页签（settings-panel.md §2.2 / §3.1「扩展」）
 * -----------------------------------------------------------------------------
 * V0.2.0 插件系统缓做（v0.3），本页先保留**结构占位 + 空态**，不实装任何扩展，
 * 故不做假开关 —— 只给「暂无扩展」图标块与说明。
 */
import { PuzzleIcon } from '../../lib/icons';

export function ExtensionsTab() {
  return (
    <div className="empty-block">
      <PuzzleIcon size={24} strokeWidth={2} className="empty-block__icon" aria-hidden />
      <p className="empty-block__title">暂无扩展</p>
      <p className="empty-block__hint">扩展系统将于 v0.3 提供；届时可在此安装与启用扩展。</p>
    </div>
  );
}
