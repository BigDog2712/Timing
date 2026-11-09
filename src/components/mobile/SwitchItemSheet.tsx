/**
 * Timing — 换事项 Sheet
 * -----------------------------------------------------------------------------
 * 两种切换（PRD P0-2）必须说人话，不能直接把 `end_and_start` / `just_switch` 抛给用户：
 *   - 结束并新开：当前这段**记入今日记录**，新事项从 0 重新计时（记录列表会出现两条）；
 *   - 仅改归属：只把这一条记录的归属改掉，秒表继续走、总时长不变（仍是一条）。
 * 空闲态没有「切换」可言，这个选择器退化成一个普通的「选一条开始」。
 *
 * [V0.11.31] 分组与电脑版对齐（主人原话「常用是用户自己设置的，参考电脑端」）：
 *   - **常用** = `items.isPinned` 的那批，**用户自己在行尾星标里设**，没有任何算法排序；
 *   - **最近用过** = 非置顶项按 `updatedAt` 倒序前 5 条（`lib/moyu.recentItems`，与电脑版
 *     同一个函数、同一个默认条数 `RECENT_ITEMS_DEFAULT`）；
 *   - **其他事项** = 剩下的全部。
 * 三段**互斥**：同一事项出现两次会让人以为库里真有两份（电脑版那块是「框 + 胶囊」两个
 * 视觉层，重复不易察觉；手机上两行一模一样的字就是 bug）。
 *
 * 星标就是「设置功能」：点一下 = 设为 / 取消常用，落 `items.is_pinned`（`item_update`），
 * 电脑版的常用列表立刻同步——同一个布尔字段，不是手机自己的一份偏好。
 *
 * 方式分段与它的一句话说明住在 `SwitchModeSheet.tsx`（事项页「计时中点待办」也用同一份文案，
 * 两边各写一份必然有一天分叉）。
 *
 * 新建事项就地完成（输入 + 回车/按钮）：手机上先跳去设置页建事项再回来，
 * 等于把一次点击拆成五次导航。
 */
import { useMemo, useState } from 'react';
import { ITEM_NAME_MAX_CHARS } from '../../lib/constants';
import { RECENT_ITEMS_DEFAULT, pinnedItems, recentItems } from '../../lib/moyu';
import { PinIcon, PinOffIcon, iconStroke } from '../../lib/icons';
import { errorText, itemApi } from '../../services/api';
import { mobileTimerActions } from '../../services/mobileTimerActions';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { Item, SwitchMode } from '../../types/domain';
import { Sheet } from './Sheet';
import { SwitchModeSeg } from './SwitchModeSheet';

/** 一行事项：左半边点了就切过去，右半边星标改常用（两个动作不能共用一个按钮） */
function ItemRow({
  item,
  current,
  busy,
  onChoose,
  onPin,
}: {
  item: Item;
  current: boolean;
  busy: boolean;
  onChoose: () => void;
  onPin: () => void;
}) {
  return (
    <li className="m-itempick">
      <button
        type="button"
        className="m-list__row"
        data-current={current ? 'true' : 'false'}
        disabled={busy}
        onClick={onChoose}
      >
        <span className="m-list__name">{item.name}</span>
        {current && <span className="m-badge">当前</span>}
      </button>
      <button
        type="button"
        className="m-pin"
        data-on={item.isPinned ? 'true' : 'false'}
        aria-label={item.isPinned ? `取消常用：${item.name}` : `设为常用：${item.name}`}
        aria-pressed={item.isPinned}
        disabled={busy}
        onClick={onPin}
      >
        {item.isPinned ? (
          <PinOffIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
        ) : (
          <PinIcon size={20} strokeWidth={iconStroke(20)} aria-hidden />
        )}
      </button>
    </li>
  );
}

export function SwitchItemSheet() {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const items = useItemStore((s) => s.items);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const [mode, setMode] = useState<SwitchMode>('end_and_start');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const currentId = session?.itemId ?? null;

  /* 三段互斥（见文件头）：先取常用，再在剩下的里面取最近，最后是其余 */
  const { pinned, recent, rest } = useMemo(() => {
    const pin = pinnedItems(items);
    const rec = recentItems(items, RECENT_ITEMS_DEFAULT);
    const shown = new Set([...pin, ...rec].map((item) => item.id));
    return { pinned: pin, recent: rec, rest: items.filter((item) => !shown.has(item.id)) };
  }, [items]);

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

  /* 星标 = 写 `items.is_pinned`（电脑版认的就是这个字段），成功后整表重拉，
     让「常用」分组立刻多出 / 少掉这一条——不重拉的话用户点完看不到任何变化，
     会以为没生效然后反复点。 */
  const togglePin = async (item: Item) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = !item.isPinned;
      await itemApi.update({ id: item.id, patch: { isPinned: next } });
      await useItemStore.getState().reload();
      useUiStore.getState().setNotice({
        tone: 'info',
        text: next ? `已把「${item.name}」设为常用` : `已取消「${item.name}」的常用`,
      });
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    const ok = await mobileTimerActions.createAndSwitch(name, mode);
    setBusy(false);
    if (ok) closeSheet('switchItem');
  };

  const section = (title: string, meta: string, list: Item[]) =>
    list.length === 0 ? null : (
      <section className="m-section m-itempick__sec">
        <header className="m-section__head">
          <h2 className="m-section__title">{title}</h2>
          <span className="m-section__meta">{meta}</span>
        </header>
        <ul className="m-list">
          {list.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              current={item.id === currentId}
              busy={busy}
              onChoose={() => void choose(item.id)}
              onPin={() => void togglePin(item)}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <Sheet
      title={status === 'idle' ? '选择事项' : '换事项'}
      onClose={() => closeSheet('switchItem')}
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

      {section('常用', `${pinned.length} 个`, pinned)}
      {section('最近用过', `${recent.length} 个`, recent)}
      {section(pinned.length > 0 || recent.length > 0 ? '其他事项' : '全部事项', `${rest.length} 个`, rest)}

      {items.length === 0 && <p className="m-empty">还没有事项，在下面输入名称新建一条。</p>}

      {/* [V0.11.32] 只说「这一下会做什么」。原先还写了「与电脑版同一份设置」——
          用户要的是知道按下去会发生什么，不是听实现细节。 */}
      <p className="m-hint">行尾的图钉 = 设为常用</p>
    </Sheet>
  );
}
