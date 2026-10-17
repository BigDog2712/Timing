/**
 * TickBar — 便利贴标题条 NoteHeader（V0.2.1：无文字，只剩右上角两枚圆点）
 * -----------------------------------------------------------------------------
 * 用户口径（V0.2.1 · 3）：便利贴去掉所有文字，仅保留输出框；右上角两枚圆点 =
 *   红点「删除」、黄点「隐藏」。
 * - 两个点都用 title / aria-label 承载语义（屏幕上不出现文字）。
 * - 删除不可撤销，故红点走**两步确认**：第一次点亮起环形高亮（armed），
 *   `ARM_MS` 内再点一次才真正删除，超时自动解除。全程零文字。
 * - `data-tauri-drag-region` 放在整条上：标题文字已去掉，这里就是唯一可拖拽区域。
 * - 未悬停整条淡出（opacity 0 / pointer-events none），由 note.css 的 .note:hover 驱动。
 */
import { useEffect, useRef, useState } from 'react';

/** 删除确认的武装窗口（毫秒） */
const ARM_MS = 3500;

interface NoteHeaderProps {
  onRequestHide: () => void;
  onRequestDelete: () => void;
}

export function NoteHeader({ onRequestHide, onRequestDelete }: NoteHeaderProps) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  const disarm = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  };

  useEffect(() => disarm, []);

  const handleDelete = () => {
    if (!armed) {
      setArmed(true);
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setArmed(false), ARM_MS);
      return;
    }
    disarm();
    onRequestDelete();
  };

  return (
    <header className="note__head" data-tauri-drag-region>
      <div className="note__dots">
        <button
          type="button"
          className="note__dot"
          data-tone="danger"
          data-armed={armed ? 'true' : 'false'}
          aria-label={armed ? '再点一次删除这张便利贴' : '删除便利贴'}
          title={armed ? '再点一次删除' : '删除'}
          onClick={handleDelete}
        />
        <button
          type="button"
          className="note__dot"
          data-tone="warn"
          aria-label="隐藏这张便利贴"
          title="隐藏"
          onClick={onRequestHide}
        />
      </div>
    </header>
  );
}
