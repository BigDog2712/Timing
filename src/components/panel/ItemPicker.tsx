/**
 * TickBar — 展开面板 ItemPicker（panel.md）
 * -----------------------------------------------------------------------------
 * 触发：点「新建事项」/ 手柄。命令：create_item / list_items / switch_item。
 * 覆盖 5 态：Populated / Typing / Empty / Error（ITEM_NAME_EMPTY）
 *          / Duplicate（ITEM_NAME_DUPLICATE + 「直接使用该事项」）/ Loading。
 * Enter 提交：无计时 → start_timer；计时中 → switch_item(end_and_start) 分段。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { IpcError, errorText, ipc } from '../../services/ipc';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { Item } from '../../types/domain';
import { AlertIcon, iconStroke } from '../../lib/icons';
import { RecentChips } from './RecentChips';
import { ShortcutHint } from './ShortcutHint';

export function ItemPicker() {
  const actions = useTimerActions();
  const items = useItemStore((s) => s.items);
  const closePanel = useUiStore((s) => s.closePanel);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const recent = useMemo(() => items.slice(0, 3), [items]);

  const activate = useCallback(
    async (itemId: number) => {
      const status = useTimerStore.getState().state.status;
      if (status === 'idle') {
        await actions.start(itemId);
      } else {
        await actions.switchTo(itemId, 'end_and_start');
        closePanel();
      }
      setName('');
      setError(null);
      setDuplicate(null);
    },
    [actions, closePanel],
  );

  const submit = useCallback(async () => {
    const value = name.trim();
    if (!value) {
      setError('事项名称不能为空');
      return;
    }
    setBusy(true);
    setError(null);
    setDuplicate(null);
    try {
      const item = await ipc.createItem({ name: value });
      await useItemStore.getState().reload();
      await activate(item.id);
    } catch (err) {
      if (err instanceof IpcError && err.code === 'ITEM_NAME_DUPLICATE') {
        const existing = useItemStore
          .getState()
          .items.find((i) => i.name.trim().toLowerCase() === value.toLowerCase());
        setDuplicate(existing ?? null);
        setError('已存在同名事项');
      } else if (err instanceof IpcError && err.code === 'ITEM_NAME_EMPTY') {
        setError('事项名称不能为空');
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }, [name, activate]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
    }
  };

  return (
    <div className="panel" role="dialog" aria-label="新建事项并开始计时">
      <div className="panel__input-wrap">
        <input
          ref={inputRef}
          className="panel__input"
          type="text"
          value={name}
          maxLength={60}
          placeholder="这一段时间在做什么？"
          aria-label="事项名称"
          aria-invalid={error != null}
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value);
            if (error) {
              setError(null);
              setDuplicate(null);
            }
          }}
          onKeyDown={handleKeyDown}
        />
        {busy && <span className="panel__spinner" aria-hidden />}
      </div>

      {error && (
        <p className="inline-error" role="alert">
          <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          <span>{error}</span>
          {duplicate && (
            <button type="button" className="inline-error__action" onClick={() => void activate(duplicate.id)}>
              直接使用该事项
            </button>
          )}
        </p>
      )}

      <RecentChips items={recent} onPick={(id) => void activate(id)} onCreate={() => inputRef.current?.focus()} />
      <ShortcutHint />
    </div>
  );
}
