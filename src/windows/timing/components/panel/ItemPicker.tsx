/**
 * Timing — 展开面板 ItemPicker（panel.md）
 * -----------------------------------------------------------------------------
 * 触发：点「新建事项」/ 手柄。命令：create_item / list_items / switch_item。
 * 覆盖 5 态：Populated / Typing / Empty / Error（`ITEM_NAME_EMPTY`）/ Loading。
 * 同名不再拦截（ADR-021）：改同名只当新建一条，不再给「直接使用该事项」的兜底入口。
 * Enter 提交：无计时 → start_timer；计时中 → switch_item(end_and_start) 分段。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { IpcError, errorText } from '../../services/ipc';
import { itemApi, tagApi } from '../../services/api';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { AlertIcon, iconStroke } from '../../lib/icons';
import { ITEM_NAME_MAX_CHARS } from '../../lib/constants';
import { RecentChips } from './RecentChips';
import { useHoverClose } from '../../hooks/useHoverClose';
import { ShortcutHint } from './ShortcutHint';
import { PanelTagField, loadTagOptions } from './PanelTagField';

export function ItemPicker() {
  const actions = useTimerActions();
  const items = useItemStore((s) => s.items);
  const closePanel = useUiStore((s) => s.closePanel);

  /* [V0.2.7] 指针离开面板即自动收起（小条触发的浮层统一行为） */
  useHoverClose(closePanel);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* [0.12.4] 标签：与事项一起创建（`create_item` 之后紧接 `set_item_tags`） */
  const [tags, setTags] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [tagHint, setTagHint] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* 候选读不到不挡新建：标签是可选信息，读失败就退回「只能手输」 */
  useEffect(() => {
    let alive = true;
    void loadTagOptions()
      .then((options) => {
        if (alive) setTagOptions(options);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
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
      setTags([]);
      setTagHint('');
      setError(null);
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
    try {
      const item = await itemApi.create({ name: value });
      /* 先建事项再挂标签：`set_item_tags` 要 itemId，而标签失败不该把刚建好的事项丢掉
         （用户至少能开始计时，标签可以随后在管理卡里补）。 */
      if (tags.length > 0) {
        try {
          await tagApi.set(item.id, tags);
        } catch {
          useUiStore.getState().setNotice({ text: '标签没保存上，可在事项管理里补', tone: 'danger' });
        }
      }
      await useItemStore.getState().reload();
      await activate(item.id);
    } catch (err) {
      if (err instanceof IpcError && err.code === 'ITEM_NAME_EMPTY') {
        setError('事项名称不能为空');
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }, [name, tags, activate]);

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
          maxLength={ITEM_NAME_MAX_CHARS}
          placeholder="这一段时间在做什么？"
          aria-label="事项名称"
          aria-invalid={error != null}
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
        />
        {busy && <span className="panel__spinner" aria-hidden />}
      </div>

      <PanelTagField
        value={tags}
        options={tagOptions}
        disabled={busy}
        onChange={setTags}
        onHint={setTagHint}
      />
      {tagHint && <p className="panel__tag-hint" role="status">{tagHint}</p>}

      {error && (
        <p className="inline-error" role="alert">
          <AlertIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          <span>{error}</span>
        </p>
      )}

      <RecentChips items={recent} onPick={(id) => void activate(id)} onCreate={() => inputRef.current?.focus()} />
      <ShortcutHint />
    </div>
  );
}
