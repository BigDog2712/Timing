/**
 * TickBar — 常用事项框 CommonItems（V0.3.9）
 * -----------------------------------------------------------------------------
 * 触发：计时中 / 暂停态**左键事项名**；空闲态点事项组件时与「新建事项」输入框**一起出**
 * （`uiStore.openCommonItemsNew`）。
 * 形态：贴着悬浮条下方展开的玻璃菜单（与摸鱼菜单同源定位）。
 *
 * 内容（用户口径）：
 *   - **置顶常用事项**：`items.is_pinned = 1`（可多条，顺序沿用后端
 *     `is_pinned DESC, sort_order ASC, id ASC`）；
 *   - **最近编辑**：按 `updated_at` 倒序的前 N 条（默认 5，可在管理卡里改或整体隐藏）；
 *     [V0.3.9 修订] 这一组**不再占整行**，改为框底一排**小胶囊**（用户口径：回到最初版的
 *     小胶囊状、尽可能小巧）：18px 高、`--text-cap` 字号、自然宽度横排换行，当前项高亮；
 *   - 分组**不写标题文字**（V0.3.9 用户口径：删掉「置顶常用事项 / 最近编辑」这类说明），
 *     置顶与胶囊之间只用一条分隔线区分；
 *   - 每行右侧 `accel` 位显示该事项的**默认倒计时**（管理卡里设的分钟数；没设就不显示）；
 *   - 右下角「事项管理」小圆点 → `ItemsPrefsMenu`（管理卡）。
 *
 * **本框不提供新建**（V0.3.9 用户口径）：新建只走事项组件自己的内联命名
 * （空闲态点「新建事项」/ 圆环无事项），框里只负责「挑一个已有的」。
 *
 * 点任意一行 = 切到该事项：设了默认倒计时就按该时长起倒计时；否则空闲开始、计时中
 * 「结束当前并开始」（分段，见 ADR-021）。
 * 指针收起策略：与摸鱼菜单一致——先移入再移出，宽限 1s（`useHoverClose` 的 requireEnter）。
 */
import { useRef, useState } from 'react';
import { useTimerActions } from '../../hooks/useTimerActions';
import { itemTimerMinutes } from '../../lib/commonItems';
import { clientToLayer } from '../../lib/fitBounds';
import { formatMinutes } from '../../lib/format';
import { PlayIcon } from '../../lib/icons';
import { pinnedItems, recentItems } from '../../lib/moyu';
import { countdownActions } from '../../services/countdownActions';
import { useCountdownArmStore } from '../../stores/countdownArm';
import { useItemStore } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import type { Item } from '../../types/domain';
import { GlassMenu, type MenuEntry } from './GlassMenu';
import { ItemsPrefsMenu } from './ItemsPrefsMenu';
import '../../styles/common-items.css';
import '../../styles/common-items-chips.css';

export function CommonItems() {
  const pos = useUiStore((s) => s.commonItemsPos);
  const close = useUiStore((s) => s.closeCommonItems);
  const items = useItemStore((s) => s.items);
  const settings = useSettingsStore((s) => s.settings);
  const status = useTimerStore((s) => s.state.status);
  /** [V0.3.9] 与「新建事项」输入框同时打开：焦点留给条上的输入框，别被菜单抢走 */
  const newItemEdit = useUiStore((s) => s.inlineEdit?.itemId === null);
  const sessionItemId = useTimerStore((s) => s.state.session?.itemId ?? null);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  const actions = useTimerActions();
  const dotRef = useRef<HTMLButtonElement>(null);
  const [prefsPos, setPrefsPos] = useState<MenuPos | null>(null);

  if (!pos) return null;

  const pinned = pinnedItems(items);
  const recent = settings.itemsShowRecent ? recentItems(items, settings.itemsRecentCount) : [];
  /* 空闲态没有会话：勾选位回落到「上次用过的事项」，至少能看出哪个是当前默认 */
  const currentId = sessionItemId ?? (status === 'idle' ? lastItemId : null);

  /** 点一行 = 切过去：有默认倒计时就按它起倒计时，否则起正计时 / 分段切换 */
  const choose = (item: Item) => {
    /* 挑到已有事项了：条上那个「新建事项」输入框就没意义了，一并收掉 */
    useUiStore.getState().closeInlineEdit();
    const minutes = itemTimerMinutes(settings.itemsTimers, item.id);
    if (minutes != null) {
      void countdownActions.start(item.id, minutes * 60, status !== 'idle');
      return;
    }
    /* 已用滚轮 / 倒计时菜单设定过档位时，挑事项后直接起倒计时（与圆环同一口径）；
       否则交给 startOrSwitch —— 空闲开始、计时中先暂停再分段（见 useTimerActions）。 */
    const armed = useCountdownArmStore.getState().armedSec;
    if (armed != null) void countdownActions.start(item.id, armed, false);
    else void actions.startOrSwitch(item.id);
  };

  const rows: MenuEntry[] = [];
  pinned.forEach((item) => {
    const minutes = itemTimerMinutes(settings.itemsTimers, item.id);
    rows.push({
      type: 'item',
      id: `pin-${item.id}`,
      label: item.name,
      /* 置顶行不带图标（用户口径：把行首那个图钉去掉） */
      accel: minutes != null ? formatMinutes(minutes * 60) : undefined,
      checked: item.id === currentId,
      onSelect: () => choose(item),
    });
  });
  /* 胶囊挂在框底（footer），这里只补一条分隔线把「置顶行」和「最近胶囊」分开 */
  if (rows.length > 0 && recent.length > 0) rows.push({ type: 'separator', id: 'sep-recent' });
  if (rows.length === 0 && recent.length === 0) {
    rows.push({
      type: 'item',
      id: 'empty',
      label: '还没有常用事项',
      icon: PlayIcon,
      disabled: true,
      onSelect: () => undefined,
    });
  }

  const openPrefs = () => {
    const rect = dotRef.current?.getBoundingClientRect();
    const at = rect ? clientToLayer(rect.left, rect.bottom) : pos;
    setPrefsPos({ x: at.x, y: at.y + 4 });
  };

  return (
    <>
      <GlassMenu
        entries={rows}
        anchor={pos}
        ariaLabel="常用事项"
        onClose={close}
        className="menu--common"
        hoverClose={{ graceMs: 1000, requireEnter: true }}
        autoFocus={!newItemEdit}
        footer={
          /* 框底一行：左边最近事项小胶囊（自然宽度、自动换行），右边「事项管理」小圆点。
             新建不在这里做（在事项组件的内联命名里）。 */
          <div className="common-items__foot">
            {recent.length > 0 && (
              <div className="common-items__chips" role="group" aria-label="最近事项">
                {recent.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="common-items__chip"
                    data-current={item.id === currentId ? 'true' : 'false'}
                    title={item.name}
                    /* 胶囊在 footer 里，不在 GlassMenu 的行渲染路径上，得自己收框
                       （整行点选是 GlassMenu 的 onClose 收的） */
                    onClick={() => {
                      choose(item);
                      close();
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
            <button
              ref={dotRef}
              type="button"
              className="common-items__dot"
              aria-label="事项管理"
              aria-haspopup="menu"
              aria-expanded={prefsPos != null}
              onClick={openPrefs}
            />
          </div>
        }
      />
      {prefsPos && (
        <ItemsPrefsMenu anchor={prefsPos} onClose={() => setPrefsPos(null)} />
      )}
    </>
  );
}
