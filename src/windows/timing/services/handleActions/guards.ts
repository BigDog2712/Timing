/**
 * Timing — 手柄动作的护栏 / 类型底座（只主窗）
 * -----------------------------------------------------------------------------
 * 这里放两样东西：
 *
 * ① **类型底座**（§4.1 的等价物）：`TimerStatus` / `TimerCtx` / `HandleActionCtx` /
 *    `HandleActionRunner` / `HandleActionGuard`。设计文档允许把它并进 `dispatch.ts`，
 *    最终选在**护栏这一层**：依赖图是 `guards → runners → dispatch` 的直线，
 *    类型放最下游就没有任何环，也不必为了几十行类型单开一个 `types.ts`
 *    （T01 的文件预算是 10 行，多一个文件就得多一次门禁解释）。
 *
 * ② **`GUARDS`：只写「不恒真」的那 5 条**。恒真的动作不进这张表 —— 表里出现的 key
 *    自带语义「这条动作有前置条件」，漏写一条的后果是「本该拦截的动作被执行」，
 *    而给恒真动作补一条 `() => true` 只会让这张表失去可读性。
 *
 * 为什么护栏只看 `TimerCtx`（status + itemId）而不看整个 ctx：护栏是纯判定，
 * 不许有副作用、不许读 UI —— 它被单测直接调用，也不该能触发任何东西。
 */
import type { TimerActions } from '../../hooks/useTimerActions';

/** 与 `timerStore` 的三态一一对应。 */
export type TimerStatus = 'idle' | 'running' | 'paused';

/** 护栏看得到的全部状态。 */
export interface TimerCtx {
  status: TimerStatus;
  itemId: number | null;
}

/** 浮层锚点（布局坐标）。由**手柄自己**在派发瞬间取 rect，注册表不自己算几何。 */
export interface HandleAnchor {
  x: number;
  y: number;
}

/**
 * uiStore 的 4 个打开动作。
 *
 * 结构类型而**不是** `import type { MenuPos } from '../../stores/uiStore'`：
 * runner 层不许 import stores（UI 状态一律从 ctx 来），否则「药丸组件碰 store」
 * 这条禁令会从 ctx 这个后门绕回来。
 */
export interface HandleActionUi {
  openPanel: (panel: 'records' | 'digest') => void;
  openNotesList: (pos: HandleAnchor) => void;
  openCountdownMenu: (arg: { pos: HandleAnchor; itemId: number | null }) => void;
  openMoyuMenu: (arg: { pos: HandleAnchor; itemId: number | null }) => void;
}

export interface HandleActionCtx extends TimerCtx {
  /** 面板 / 菜单锚点：由手柄在派发瞬间取 rect（与既有便利贴手柄同一口径）。 */
  anchor: () => HandleAnchor;
  /** 计时动作：`PillBar` 的 `useTimerActions()` 原样传入，禁止在注册表里重建编排。 */
  timer: TimerActions;
  ui: HandleActionUi;
  /** 护栏不通过时的提示通道（A-07：不静默）。 */
  notice: (text: string) => void;
}

export type HandleActionRunner = (ctx: HandleActionCtx) => void | Promise<void>;
export type HandleActionGuard = (ctx: TimerCtx) => boolean;

export const GUARDS: Record<string, HandleActionGuard> = {
  /* 已在计时中再点「开始」只会换来后端一条 TIMER_ALREADY_RUNNING 报错 */
  'timer.start': (ctx) => ctx.status !== 'running',
  /* 空闲态没有可暂停的会话；暂停态再「暂停」等于继续（语义反转，最容易被误点） */
  'timer.pause': (ctx) => ctx.status === 'running',
  /* 结束并保存是不可逆动作：空闲态点它必须被拦下，否则用户以为「结束了一件事」 */
  'timer.stop': (ctx) => ctx.status !== 'idle',
  /* 倒计时本身就是一种计时，运行中开菜单会和当前会话抢同一个 store 位 */
  'menu.countdown': (ctx) => ctx.status === 'idle',
  /* 摸鱼菜单的选项是「切到某条摸鱼项继续计时」，只有暂停态才有「继续」这件事 */
  'menu.moyu': (ctx) => ctx.status === 'paused',
};
