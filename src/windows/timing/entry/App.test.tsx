/**
 * Timing — 主窗形态切换（[0.13.x] 点托盘图标 → 圆点临时变条、闪完收回）
 * -----------------------------------------------------------------------------
 * 用户口径：「点击任务栏图标的高亮提醒在小圆点形态失效。应小圆点变为悬浮条形态高亮，
 * 结束后恢复小圆点形态」。本轮补的是**形态临时切换**（不是加闪烁 —— 圆点本来就会闪，
 * 见 CollapsedDot.test.tsx 最后一段），所以在 `entry/App.tsx` 的装配层验：
 *
 *   1. 常驻圆点 + 当前收起 → `flashHighlight()` → 渲染的是 PillBar（`.pill`）而不是圆点
 *      （`.dot`），且 PillBar 自己挂上 `data-highlight="true"`；
 *   2. 到了 `HIGHLIGHT_MS` **不立刻收**，而是转由既有的 `scheduleCollapse`（300ms 延迟）
 *      收回 —— 这条断言就是「共用同一套护栏」的证据：少一次也说明它走了旁路；
 *      面板开着时同一套护栏必须保住条不收（`hasOpenSurface`）；
 *   3. 常驻悬浮条（`floatForm='bar'`）触发高亮 → 形态不变（仍在 `.pill`，`collapsed` 不动）；
 *   4. 用户**自己**展开的条，高亮到点不替他收；
 *   5. 拖动中（`isDragActive()`）不展开；松手后恢复正常；
 *   6. 连点两次只留一个收回定时器（第一个定时器必须被清掉）。
 *
 * 这里渲染的是**真的** PillBar / CollapsedDot（只有兄弟浮层与 bootstrap 类副作用被桩掉），
 * 所以 `data-highlight` 是组件自己算出来的，不是测试替身的自证。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { HIGHLIGHT_MS } from '../lib/constants';
import { markDragActive, markDragIdle } from '../lib/dragState';
import { useAppearanceStore } from '../stores/appearanceStore';
import { useTimerStore, IDLE_TIMER_STATE } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';

/* 兄弟浮层与「启动副作用」全部桩掉：本文件只验形态切换，它们与本案无关，
   留着反而会把 IPC / 事件订阅 / 窗口几何拖进来。PillBar 与 CollapsedDot **不桩**。 */
vi.mock('../components/Batch2Overlays', () => ({ Batch2Overlays: () => null }));
vi.mock('../components/menu/ItemMenu', () => ({ ItemMenu: () => null }));
vi.mock('../components/mobile/MobileShell', () => ({ MobileShell: () => null }));
vi.mock('../components/note/NoteWindow', () => ({ NoteWindow: () => null }));
vi.mock('../components/note/NotesListPopover', () => ({ NotesListPopover: () => null }));
vi.mock('../components/panel/ItemPicker', () => ({ ItemPicker: () => null }));
vi.mock('../components/records/RecordsPanel', () => ({ RecordsPanel: () => null }));
vi.mock('../components/recover/RecoverDialog', () => ({ RecoverDialog: () => null }));
vi.mock('../components/todos/TodayDigest', () => ({ TodayDigest: () => null }));
vi.mock('../components/todos/TodosWindow', () => ({ TodosWindow: () => null }));
vi.mock('../components/timer/TimerWindow', () => ({ TimerWindow: () => null }));
vi.mock('../components/undo/UndoBar', () => ({ UndoBar: () => null }));
vi.mock('../components/ui/NoticeBar', () => ({ NoticeBar: () => null }));
vi.mock('../hooks/useAppBootstrap', () => ({ useAppBootstrap: () => undefined }));
vi.mock('../hooks/useItemsRefreshOnFocus', () => ({ useItemsRefreshOnFocus: () => undefined }));
vi.mock('../hooks/useAppBindingAutoTimer', () => ({ useAppBindingAutoTimer: () => undefined }));
vi.mock('../hooks/useWindowAutoFit', () => ({ useWindowAutoFit: () => undefined }));
vi.mock('../services/hostIntentBridge', () => ({ useHostIntentBridge: () => undefined }));
vi.mock('../services/todosActions', () => ({ openTodosWindow: () => Promise.resolve() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  markDragIdle();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useTimerStore.getState().setState(IDLE_TIMER_STATE);
  useUiStore.setState({
    collapsed: false,
    panel: 'none',
    highlightSeq: 0,
    endedAt: null,
    undoRecord: null,
    undoDeadline: null,
    recover: null,
    countdownPos: null,
    countdownCardPos: null,
    reminderPopover: null,
    notesListPos: null,
    itemMenu: null,
    moyuPos: null,
    commonItemsPos: null,
    inlineEdit: null,
  });
  useAppearanceStore.setState({ floatForm: 'bar' });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  markDragIdle();
  vi.useRealTimers();
});

/** 常驻圆点 + 当前收起（= 用户报的那个形态） */
function setDotForm(): void {
  useAppearanceStore.setState({ floatForm: 'dot' });
  useUiStore.setState({ collapsed: true });
}

function mount(): void {
  act(() => {
    root.render(<App />);
  });
}

function pill(): HTMLElement | null {
  return container.querySelector<HTMLElement>('.pill');
}

function dot(): HTMLElement | null {
  return container.querySelector<HTMLElement>('.dot');
}

/** 触发一次托盘双击高亮，并把定时器推进 `ms` 毫秒 */
function flash(ms = 0): void {
  act(() => {
    useUiStore.getState().flashHighlight();
  });
  if (ms > 0) act(() => void vi.advanceTimersByTime(ms));
}

describe('常驻圆点 → 高亮临时变条 → 闪完自动收回', () => {
  it('flashHighlight() 后渲染的是 PillBar（不是圆点），且它自己挂上了 data-highlight', () => {
    setDotForm();
    mount();
    /* 前置：确实是圆点形态，否则下面「变成条」就无从谈起 */
    expect(dot()).not.toBeNull();
    expect(pill()).toBeNull();

    flash();

    expect(dot()).toBeNull();
    expect(pill()).not.toBeNull();
    expect(pill()?.dataset.highlight).toBe('true');
  });

  it('HIGHLIGHT_MS 到点后仍不立刻收：走既有 scheduleCollapse 的 300ms，再收回圆点', () => {
    setDotForm();
    mount();
    flash();

    /* 闪完那一刻：条必须还在。若谁把「收回」改成在高亮回调里直接 setCollapsed(true)，
       这一条立刻红（那就等于绕开了统一的护栏）。 */
    act(() => void vi.advanceTimersByTime(HIGHLIGHT_MS));
    expect(pill()).not.toBeNull();

    /* 再走完 scheduleCollapse 的 300ms 延迟 → 回到圆点 */
    act(() => void vi.advanceTimersByTime(300));
    expect(dot()).not.toBeNull();
    expect(pill()).toBeNull();
    /* 只改 collapsed，用户的常驻形态设定一概不动 */
    expect(useUiStore.getState().collapsed).toBe(true);
    expect(useAppearanceStore.getState().floatForm).toBe('dot');
  });

  it('用户在高亮期间打开了面板：同一套护栏（hasOpenSurface）保住条，不替他收', () => {
    setDotForm();
    mount();
    flash();
    /* 模拟「闪的过程中点了某个面板」 */
    act(() => {
      useUiStore.setState({ panel: 'records' });
    });

    act(() => void vi.advanceTimersByTime(HIGHLIGHT_MS + 400));
    expect(pill()).not.toBeNull();
    expect(dot()).toBeNull();
  });
});

describe('不该越权的情形', () => {
  it('常驻悬浮条（floatForm=bar）触发高亮：形态不变，仍在 PillBar', () => {
    /* 前置：bar 形态、条已展开 */
    mount();
    expect(pill()).not.toBeNull();

    flash(HIGHLIGHT_MS + 400);

    expect(pill()).not.toBeNull();
    expect(dot()).toBeNull();
    expect(useUiStore.getState().collapsed).toBe(false);
    expect(useAppearanceStore.getState().floatForm).toBe('bar');
  });

  it('用户自己点开的条（不是高亮放出来的）：到点也不收', () => {
    useAppearanceStore.setState({ floatForm: 'dot' });
    useUiStore.setState({ collapsed: false });
    mount();
    expect(pill()).not.toBeNull();

    flash(HIGHLIGHT_MS + 400);

    /* 他自己展开的，收回由鼠标离开那条既有路径负责，不是我们 */
    expect(pill()).not.toBeNull();
    expect(useUiStore.getState().collapsed).toBe(false);
  });

  it('拖动中触发高亮：不展开（拖窗时改窗口尺寸会打断拖动），松手后恢复', () => {
    setDotForm();
    mount();
    markDragActive();

    flash();
    expect(dot()).not.toBeNull();
    expect(pill()).toBeNull();

    markDragIdle();
    flash();
    expect(pill()).not.toBeNull();
  });

  it('连点两次只留一个收回定时器：第一次的定时器被清掉，不会提前收回', () => {
    setDotForm();
    mount();
    flash();
    /* t=1000 再点一次：收回定时器应被重排到 1000 + HIGHLIGHT_MS */
    act(() => void vi.advanceTimersByTime(1000));
    flash();

    /* t=3700：若第一次的定时器没被清，t=2500 就会排上收回、t=2800 已经变回圆点了 */
    act(() => void vi.advanceTimersByTime(HIGHLIGHT_MS + 200));
    expect(pill()).not.toBeNull();

    /* t=4000：第二次的 HIGHLIGHT_MS(3500) + 300ms 延迟走完 → 收回 */
    act(() => void vi.advanceTimersByTime(300));
    expect(dot()).not.toBeNull();
  });
});
