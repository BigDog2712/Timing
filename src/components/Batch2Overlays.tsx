/**
 * TickBar — 批2 主窗浮层装配 Batch2Overlays（倒计时 / 提醒 / 摸鱼菜单）
 * -----------------------------------------------------------------------------
 * 两者为**互斥的瞬时浮层**，状态在各窗自己的 uiStore（多窗各自实例，K-21 同款思路）。
 * 因此主窗与事项窗**各自挂载一份**：在哪个窗触发，就在哪个窗浮出。
 * （便利贴窗不挂——它不承载这些入口。）
 *
 * [V0.3.1] 「常用事项」浮层已删除（含固定任务 / 最近 5 条 / 托盘「编辑固定任务…」）。
 * [V0.3.2] 新增摸鱼菜单：暂停态的快捷「换件事 + 定长」，内容来自插件贡献。
 */
import { CountdownCard } from './menu/CountdownCard';
import { CountdownMenu } from './menu/CountdownMenu';
import { CommonItems } from './menu/CommonItems';
import { MoyuMenu } from './menu/MoyuMenu';
import { ReminderPopover } from './reminder/ReminderPopover';
import { useUiStore } from '../stores/uiStore';

export function Batch2Overlays() {
  const countdownPos = useUiStore((s) => s.countdownPos);
  const countdownCardPos = useUiStore((s) => s.countdownCardPos);
  const closeCountdownCard = useUiStore((s) => s.closeCountdownCard);
  const openCountdownMenu = useUiStore((s) => s.openCountdownMenu);
  const reminderPopover = useUiStore((s) => s.reminderPopover);
  const moyuPos = useUiStore((s) => s.moyuPos);
  const commonItemsPos = useUiStore((s) => s.commonItemsPos);

  return (
    <>
      {countdownCardPos && <CountdownCard anchor={countdownCardPos} onClose={closeCountdownCard} onMenu={(pos) => openCountdownMenu({ pos, custom: true })} />}
      {countdownPos && <CountdownMenu state={countdownPos} />}
      {moyuPos && <MoyuMenu state={moyuPos} />}
      {commonItemsPos && <CommonItems />}
      {reminderPopover && <ReminderPopover state={reminderPopover} />}
    </>
  );
}
