/**
 * Timing — 事项行长按菜单（停止计时 / 编辑 / 归档 / 删除）
 * -----------------------------------------------------------------------------
 * 桌面的右键菜单（`ItemMenu` / `TodosItemMenu`）在手机上必须是长按（PRD §5 D11），
 * 而且必须给**停止计时**一个位置——手机上用户不会去猜「再点一次行就是停」。
 *
 * 删除与归档的差别写进文案：归档只是从选择器里消失、历史记录还在；
 * 删除是软删事项，历史记录同样保留（ADR-021），但新建同名事项会得到**新 id**。
 * 「未归类」受后端保护：删除 / 归档都会返回 ITEM_SYSTEM_PROTECTED，这里只把错误转成提示。
 */
import { useState } from 'react';
import { ITEM_NAME_MAX_CHARS } from '../../lib/constants';
import { errorText, itemApi } from '../../services/api';
import { renameItem } from '../../services/itemRowActions';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { itemName, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { Sheet } from './Sheet';

interface ItemMenuSheetProps {
  itemId: number;
}

export function ItemMenuSheet({ itemId }: ItemMenuSheetProps) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const bumpRecords = useMobileUiStore((s) => s.bumpRecords);
  const items = useItemStore((s) => s.items);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const timerActions = useTimerActions();
  const [mode, setMode] = useState<'menu' | 'rename' | 'confirmDelete'>('menu');
  const [name, setName] = useState(() => itemName(items, itemId));
  const [busy, setBusy] = useState(false);

  const current = items.find((i) => i.id === itemId);
  const isActive = status !== 'idle' && session?.itemId === itemId;

  const fail = (err: unknown) => {
    useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
  };

  const run = async (fn: () => Promise<unknown>, done: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      done();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const doRename = () => {
    const next = name.trim();
    if (!next || next === current?.name) {
      closeSheet('itemMenu');
      return;
    }
    void run(() => renameItem(itemId, next), closeSheet);
  };

  const doArchive = () => {
    void run(async () => {
      await itemApi.archive({ id: itemId });
      await useItemStore.getState().reload();
      bumpRecords();
    }, closeSheet);
  };

  const doDelete = () => {
    void run(async () => {
      await itemApi.remove({ id: itemId });
      await useItemStore.getState().reload();
      bumpRecords();
    }, closeSheet);
  };

  const footer =
    mode === 'rename' ? (
      <div className="m-sheet__foot-row">
        <button type="button" className="m-btn m-field--grow" onClick={() => setMode('menu')}>
          取消
        </button>
        <button type="button" className="m-btn m-btn--primary" disabled={!name.trim() || busy} onClick={doRename}>
          保存名称
        </button>
      </div>
    ) : mode === 'confirmDelete' ? (
      <div className="m-sheet__foot-row">
        <button type="button" className="m-btn m-field--grow" onClick={() => setMode('menu')}>
          取消
        </button>
        <button type="button" className="m-btn m-btn--danger" disabled={busy} onClick={doDelete}>
          确认删除
        </button>
      </div>
    ) : undefined;

  return (
    <Sheet title={current?.name ?? '事项'} onClose={closeSheet} footer={footer}>
      {mode === 'menu' && (
        <div className="m-actions">
          <button
            type="button"
            className="m-action"
            disabled={!isActive}
            data-tone="danger"
            onClick={() =>
              void run(async () => {
                await timerActions.stop();
              }, closeSheet)
            }
          >
            停止计时
            {!isActive && <span className="m-action__hint">这条没有在计时</span>}
          </button>
          <button type="button" className="m-action" onClick={() => setMode('rename')}>
            编辑名称
          </button>
          <button type="button" className="m-action" onClick={doArchive}>
            归档
            <span className="m-action__hint">从选择器里移除，历史记录保留</span>
          </button>
          <button type="button" className="m-action" data-tone="danger" onClick={() => setMode('confirmDelete')}>
            删除
            <span className="m-action__hint">软删除事项，历史记录仍归属它</span>
          </button>
        </div>
      )}

      {mode === 'rename' && (
        <label className="m-field">
          <span className="m-field__label">事项名称</span>
          <input
            className="m-input"
            value={name}
            maxLength={ITEM_NAME_MAX_CHARS}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doRename();
            }}
          />
        </label>
      )}

      {mode === 'confirmDelete' && (
        <p className="m-hint">删除「{current?.name}」后它不再出现在选择器，今日记录里仍按原归属显示。</p>
      )}
    </Sheet>
  );
}
