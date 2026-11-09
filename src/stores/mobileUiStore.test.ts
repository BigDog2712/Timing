/**
 * Timing — 移动壳 UI store 的回归判据（[V0.11.30]）
 * -----------------------------------------------------------------------------
 * 这一轮主人报的三条「点了没反应」——倒计时面板的 X、换事项面板的 X、事项编辑面板的 X
 * ——是**同一个** bug：`Sheet` 的关闭按钮写成 `onClick={onClose}`，React 把 MouseEvent
 * 当第一个实参传进 `closeSheet(kind?)`，而旧实现用 `kind != null` 判断：
 *
 *   kind = MouseEvent → truthy → `s.sheet.kind !== kind` 恒真 → 返回原 state → 面板不动
 *
 * 这类 bug 用组件测试很难钉（要真的点渲染出来的按钮），但它的**本质是 store 的入参契约**，
 * 所以判据放在这里：非字符串实参一律当「没指定类型」，必须关。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useMobileUiStore } from './mobileUiStore';

describe('closeSheet 的入参契约（V0.11.30）', () => {
  beforeEach(() => {
    useMobileUiStore.setState({ sheet: null });
  });

  it('closes_without_kind', () => {
    useMobileUiStore.getState().openSheet({ kind: 'countdown' });
    useMobileUiStore.getState().closeSheet();
    expect(useMobileUiStore.getState().sheet).toBeNull();
  });

  it('closes_when_kind_matches', () => {
    useMobileUiStore.getState().openSheet({ kind: 'countdown' });
    useMobileUiStore.getState().closeSheet('countdown');
    expect(useMobileUiStore.getState().sheet).toBeNull();
  });

  /** 异步收尾只许关自己那张：用户可能已经开了别的面板（V0.11.2 的口径，别改坏）。 */
  it('keeps_other_kind_open', () => {
    useMobileUiStore.getState().openSheet({ kind: 'countdown' });
    useMobileUiStore.getState().closeSheet('switchItem');
    expect(useMobileUiStore.getState().sheet?.kind).toBe('countdown');
  });

  /**
   * **这一条是回归本体**：把 MouseEvent 当 kind 传进来（`onClose={closeSheet}` 就是这么做），
   * 旧实现会静默不关。判据用最小的事件形状，不必真造一个 DOM 事件。
   */
  it('closes_even_when_a_click_event_is_passed_as_kind', () => {
    useMobileUiStore.getState().openSheet({ kind: 'switchItem' });
    const fakeEvent = { type: 'click', target: null, preventDefault: () => undefined };
    // @ts-expect-error 故意用错类型：真实场景就是 React 把 MouseEvent 塞进这个形参
    useMobileUiStore.getState().closeSheet(fakeEvent);
    expect(useMobileUiStore.getState().sheet).toBeNull();
  });

  /** 同样的错误写法在 `onClick={closeSheet}` 上也会发生（遮罩点击）。 */
  it('closes_when_a_pointer_event_is_passed_as_kind', () => {
    useMobileUiStore.getState().openSheet({ kind: 'itemMenu', itemId: 3 });
    // @ts-expect-error 同上：故意用错类型，复现 onClick 裸传的调用形态
    useMobileUiStore.getState().closeSheet({ pointerId: 1, clientX: 10, clientY: 20 });
    expect(useMobileUiStore.getState().sheet).toBeNull();
  });
});
