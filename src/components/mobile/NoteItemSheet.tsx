/**
 * Timing — 便利贴改归属 Sheet（V0.11.0）
 * -----------------------------------------------------------------------------
 * 只做一件事：把这张便利贴挂到某个事项，或者解绑成随记。
 * 选完自动回到编辑页（`noteEdit`），不让人再点一次返回——手机上多一次导航就是多一次放弃。
 *
 * 首行「随记」= `itemId: null`，与桌面「关联事项…」里的解绑是同一个语义（AC-63）。
 */
import { useState } from 'react';
import { AlertIcon, iconStroke } from '../../lib/icons';
import { bindNote } from '../../services/mobileNoteActions';
import { useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { Sheet } from './Sheet';

interface NoteItemSheetProps {
  noteId: number;
}

export function NoteItemSheet({ noteId }: NoteItemSheetProps) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const openSheet = useMobileUiStore((s) => s.openSheet);
  const items = useItemStore((s) => s.items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (itemId: number | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const updated = await bindNote(noteId, itemId);
    setBusy(false);
    if (!updated) {
      setError('没能改归属，稍后再试');
      return;
    }
    openSheet({ kind: 'noteEdit', noteId });
  };

  return (
    <Sheet title="归属事项" onClose={closeSheet}>
      {error && (
        <p className="m-error" role="alert">
          <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          {error}
        </p>
      )}

      <ul className="m-list">
        <li>
          <button type="button" className="m-list__row" disabled={busy} onClick={() => void choose(null)}>
            <span className="m-list__name">随记（不挂事项）</span>
          </button>
        </li>
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="m-list__row" disabled={busy} onClick={() => void choose(item.id)}>
              <span className="m-list__name">{item.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
