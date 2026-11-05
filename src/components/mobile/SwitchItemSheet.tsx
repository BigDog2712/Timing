/**
 * Timing — 换事项 Sheet
 * -----------------------------------------------------------------------------
 * 两种切换（PRD P0-2）必须说人话，不能直接把 `end_and_start` / `just_switch` 抛给用户：
 *   - 结束并新开：当前这段**记入今日记录**，新事项从 0 重新计时（记录列表会出现两条）；
 *   - 仅改归属：只把这一条记录的归属改掉，秒表继续走、总时长不变（仍是一条）。
 * 空闲态没有「切换」可言，这个选择器退化成一个普通的「选一条开始」。
 *
 * 方式分段与它的一句话说明住在 `SwitchModeSheet.tsx`（事项页「计时中点待办」也用同一份文案，
 * 两边各写一份必然有一天分叉）。
 *
 * 新建事项就地完成（输入 + 回车/按钮）：手机上先跳去设置页建事项再回来，
 * 等于把一次点击拆成五次导航。
 */
import { useState } from 'react';
import { ITEM_NAME_MAX_CHARS } from '../../lib/constants';
import { mobileTimerActions } from '../../services/mobileTimerActions';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import type { SwitchMode } from '../../types/domain';
import { Sheet } from './Sheet';
import { SwitchModeSeg } from './SwitchModeSheet';

export function SwitchItemSheet() {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const items = useItemStore((s) => s.items);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const [mode, setMode] = useState<SwitchMode>('end_and_start');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const currentId = session?.itemId ?? null;

  const choose = async (itemId: number) => {
    /* 点的是当前这条：什么都不用做，关掉即可（避免误触发一次分段） */
    if (itemId === currentId) {
      closeSheet('switchItem');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await mobileTimerActions.switchTo(itemId, mode);
    } finally {
      setBusy(false);
      closeSheet('switchItem');
    }
  };

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    const ok = await mobileTimerActions.createAndSwitch(name, mode);
    setBusy(false);
    if (ok) closeSheet('switchItem');
  };

  return (
    <Sheet
      title={status === 'idle' ? '选择事项' : '换事项'}
      onClose={closeSheet}
      footer={
        <div className="m-sheet__foot-row">
          <input
            className="m-input m-field--grow"
            value={name}
            maxLength={ITEM_NAME_MAX_CHARS}
            placeholder="新建事项名称"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
          <button type="button" className="m-btn m-btn--primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            新建并开始
          </button>
        </div>
      }
    >
      {status !== 'idle' && <SwitchModeSeg mode={mode} onChange={setMode} disabled={busy} />}

      <ul className="m-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="m-list__row"
              data-current={item.id === currentId ? 'true' : 'false'}
              disabled={busy}
              onClick={() => void choose(item.id)}
            >
              <span className="m-list__name">{item.name}</span>
              {item.id === currentId && <span className="m-badge">当前</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
