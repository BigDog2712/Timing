/**
 * Timing — 指针离开即收的浮层（V0.2.7 / V0.3.9 支持「先移入再移出」）
 * -----------------------------------------------------------------------------
 * 用户要求：**所有由悬浮条触发的浮层**，在指针离开后自动收起；便利贴例外。
 * 便利贴是独立窗口（`note-{id}`，自己一份文档），天然不挂这个 hook，故「例外」是结构性的。
 *
 * 判定规则（比 `pointerleave` 宽松，避免「手一抖就没了」）：
 * - 指针落在 `KEEP_ALIVE_SELECTOR` 命中的容器上（小条本身 / 任何浮层）= 还在用小条这套 UI，**不计时**；
 * - 指针离开这些容器后起 `graceMs` 计时，期间回到任意容器即取消；
 * - 计时到点才真正 `onClose()`。
 *
 * 为什么用 document 级 pointermove 而不是元素上的 pointerleave：
 * 浮层与小条之间常有几像素空隙，指针穿过去的一瞬间会触发 `pointerleave`，
 * 只看元素自身会在「从菜单移回小条」时误收。
 *
 * [V0.3.9] `requireEnter`（自动弹出的浮层用）：
 * 暂停即弹的摸鱼菜单出现时，指针还在小条上。旧规则下指针只要离开小条就起 420ms 计时，
 * 用户还没来得及移到菜单，浮层就消失了。开启后：
 *   - 指针**必须先进入过浮层**（`.menu` / `.panel` / … 任一），才会开始「离开即收」计时；
 *   - 进入后移出，宽限 `graceMs`（默认 1s）再收；
 *   - 指针直接移出窗口（桌面）仍立即计时收起——人已经离开这套 UI 了。
 *
 * [V0.3.9] 挂载静默期 `MOUNT_GUARD_MS`：浮层出现的那一帧 auto-fit 会改窗口尺寸，
 * WebView2 偶尔在 `documentElement` 上补派一次 `mouseleave`（不是用户真的走开），
 * 那一下会把收起计时拉起来。静默期内的 leave 只把等待补足到「静默期结束 + 宽限」。
 *
 * [V0.3.9] 打字豁免：焦点在浮层内的输入框里时，`documentElement` 的 leave 一律不算离开
 * （窗口尺寸/焦点变化、IME 候选窗都会触发假 leave，表现为「打字打着框没了」）。
 * 真移出去会经过 pointermove，那条路径照旧起算。
 */
import { useEffect, useRef } from 'react';
import { HOVER_CLOSE_GRACE_MS } from '../lib/constants';

/** 指针停在这些容器上时不算「离开」：小条 + 各类浮层（菜单 / 面板 / 记录 / 提醒卡） */
const PANEL_SELECTOR = '.menu, .panel, .records, .reminder, .note';
const KEEP_ALIVE_SELECTOR = `.pill, ${PANEL_SELECTOR}`;

/**
 * [V0.3.9] 挂载后的静默期（ms）：浮层出现的那一帧，auto-fit 会改 OS 窗口尺寸/位置，
 * WebView2 有时会顺手在 `documentElement` 上派发一次 `mouseleave`——那一下不是用户真的
 * 把指针移开了，却会把收起计时器拉起来，浮层看起来「刚开就没了」。
 * 静默期内只记状态、不拉起收起计时。
 */
const MOUNT_GUARD_MS = 320;

/**
 * [V0.3.9] 焦点是否落在「小条 / 浮层」里的文本输入控件上（正在打字）。
 * WebView2 在窗口尺寸变动 / 焦点切换 / IME 候选窗出现时会**补派**一次
 * `documentElement` 的 `leave`——用户明明还在输入，浮层却按「离开了」算，打字中途消失。
 * 常用事项框同步弹出的「新建事项」输入框在小条上，管理卡的输入框在菜单里，两者都要保住：
 * 只有「指针真的移出去」（会经过 pointermove，见 handleMove）才收。
 */
function isTypingInKeepAlive(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  return typing && !!el.closest?.(KEEP_ALIVE_SELECTOR);
}

export interface HoverCloseOptions {
  /** 离开后的宽限（毫秒），默认 `HOVER_CLOSE_GRACE_MS` */
  graceMs?: number;
  /** 是否要求指针先进入过浮层（自动弹出的浮层传 true） */
  requireEnter?: boolean;
}

export function useHoverClose(onClose: () => void, enabled = true, options?: HoverCloseOptions): void {
  /* 回调常是内联箭头函数，用 ref 托住，避免每次渲染重挂 document 监听 */
  const closeRef = useRef(onClose);
  const graceRef = useRef(options?.graceMs ?? HOVER_CLOSE_GRACE_MS);
  const requireEnterRef = useRef(options?.requireEnter ?? false);

  useEffect(() => {
    closeRef.current = onClose;
    graceRef.current = options?.graceMs ?? HOVER_CLOSE_GRACE_MS;
    requireEnterRef.current = options?.requireEnter ?? false;
  }, [onClose, options?.graceMs, options?.requireEnter]);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | null = null;
    /* 不要求「先移入」时视为已满足，行为与 V0.2.7 完全一致 */
    let entered = !requireEnterRef.current;
    /* 挂载后的静默期：这一小段时间里的 leave 不算数（见 MOUNT_GUARD_MS） */
    const mountedAt = Date.now();

    const cancel = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const armClose = () => {
      if (timer != null) return;
      /* 静默期内起算的话，把等待时间补足到「静默期结束 + 宽限」，而不是直接忽略——
         忽略会让「开窗那一下真的把指针甩出去」的场景永远不收起。 */
      const guardLeft = Math.max(0, MOUNT_GUARD_MS - (Date.now() - mountedAt));
      timer = window.setTimeout(() => {
        timer = null;
        closeRef.current();
      }, graceRef.current + guardLeft);
    };

    const handleMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      /* 还在小条或浮层里 → 取消待收；落在浮层上则记为「已移入」 */
      if (target?.closest?.(KEEP_ALIVE_SELECTOR)) {
        if (target.closest(PANEL_SELECTOR)) entered = true;
        cancel();
        return;
      }
      /* 要求先移入但还没进过浮层 → 不计时（正是「唤出即消失」的根因） */
      if (!entered) return;
      /* 已经离开并且已经在倒计时 → 不重置，避免「一直动鼠标永不收」 */
      armClose();
    };

    const leave = () => {
      /* 正在小条 / 浮层里打字时，这条 leave 多半是 WebView2 补派的假事件（见 isTypingInKeepAlive）：
         真移出去一定伴随 pointermove，那条路径由 handleMove 负责起算。 */
      if (isTypingInKeepAlive() && document.hasFocus()) return;
      /* 指针离开窗口：无论是否进过浮层都收（人已经离开这套 UI） */
      armClose();
    };
    const root = document.documentElement;
    document.addEventListener('pointermove', handleMove, true);
    // Leaving the native WebView produces no further document pointermove.
    root.addEventListener('pointerleave', leave);
    root.addEventListener('mouseleave', leave);
    root.addEventListener('pointerenter', cancel);
    root.addEventListener('mouseenter', cancel);
    return () => {
      cancel();
      document.removeEventListener('pointermove', handleMove, true);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('mouseleave', leave);
      root.removeEventListener('pointerenter', cancel);
      root.removeEventListener('mouseenter', cancel);
    };
  }, [enabled]);
}
