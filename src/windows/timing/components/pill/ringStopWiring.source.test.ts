/**
 * Timing — 「计时中右键圆环 = 结束并保存」的**接线**判据（[本轮]）
 * -----------------------------------------------------------------------------
 * 主人报「悬浮框左侧小圆环右键点击结束指令失效」。根因不是坏而是**没接线**：
 * A4（b52e347）以防误触为由把 `MainButton` 的 `onMenu` 从 PillBar 摘掉了，
 * 于是右键圆环什么都不做。本轮按用户口径恢复。这类「写了但没接线」的坑
 * 本仓已经掉过好几次（见 `usePillAction.source.test.ts` 的头注释），照它的
 * 先例钉成源码判据：谁再摘这条线，先红。
 *
 * 判据都在**去掉注释**之后比：恢复理由在注释里会正当地出现，拿注释当证据
 * 会让用例变成「谁改注释谁红」。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 读源码并去掉注释（`/* … *\/` 与行首 `//`）。 */
function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PILLBAR = code('./PillBar.tsx');
const MAIN_BUTTON = code('./MainButton.tsx');

describe('右键圆环 = 结束并保存：接线判据（[本轮] 用户口径）', () => {
  /**
   * PillBar 必须把 `onMenu` 递给 MainButton，且空闲态不绑（没有会话可结束）。
   * 只检「onMenu」三个字是不够的——那是任何右键菜单都满足的；钉的是**绑的动作
   * 是 stop 且空闲不绑**这两件事同时在场。
   */
  it('pillbar_binds_ring_right_click_to_stop_when_not_idle', () => {
    expect(PILLBAR).toContain("onMenu={status === 'idle' ? undefined : () => void actions.stop()}");
  });

  /** MainButton 的右键派发链不能断：pointerup(2) 直接调 onMenu（contextmenu 只做去重兜底）。 */
  it('main_button_still_dispatches_right_click_to_onMenu', () => {
    expect(MAIN_BUTTON).toContain('onMenu(clientToLayer(e.clientX, e.clientY))');
    /* pointerup(2) 是主派发入口；缺了它 WebView2 不派 contextmenu 的输入路径下右键就丢 */
    expect(MAIN_BUTTON).toMatch(/button !== 2\) return;/);
  });
});
