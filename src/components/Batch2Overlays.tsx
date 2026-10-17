/**
 * TickBar — 批2 主窗浮层装配 Batch2Overlays（倒计时 / 常用事项 / 提醒）
 * -----------------------------------------------------------------------------
 * 三者为**互斥的瞬时浮层**，状态在各窗自己的 uiStore（多窗各自实例，K-21 同款思路）。
 * 因此主窗与事项窗**各自挂载一份**：在哪个窗触发，就在哪个窗浮出。
 * （便利贴窗不挂——它不承载这些入口。）
 */
import { CountdownMenu } from './menu/CountdownMenu';
import { CommonItems } from './panel/CommonItems';
import { ReminderPopover } from './reminder/ReminderPopover';
import { useUiStore } from '../stores/uiStore';

export function Batch2Overlays() {
  const countdownPos = useUiStore((s) => s.countdownPos);
  const commonItemsPos = useUiStore((s) => s.commonItemsPos);
  const reminderPopover = useUiStore((s) => s.reminderPopover);

  return (
    <>
      {countdownPos && <CountdownMenu state={countdownPos} />}
      {commonItemsPos && <CommonItems anchor={commonItemsPos} />}
      {reminderPopover && <ReminderPopover state={reminderPopover} />}
    </>
  );
}
