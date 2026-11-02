/**
 * `UndoBar` —— V0.3.4 起只剩**一种形态**（ADR-023）。
 *
 * 原来短记录会变成「只记了 N 秒，要留下吗？保存 / 丢弃」的二选一，于是同一个组件有两种
 * 结构（多一个按钮组 + `data-short` 属性）。现在短会话已在后端被阈值直接忽略，
 * 这个二选一失去了存在理由，两种形态必须**归一**——回归的方式很隐蔽：多加回一个按钮、
 * 或者给根节点挂回 `data-short` 让 CSS 重新分支，肉眼都不明显。
 *
 * 渲染走真实 DOM（`createRoot` + `act`）而不是 SSR：zustand v5 的
 * `useSyncExternalStore(..., getInitialState)` 在 `renderToStaticMarkup` 下永远读**初始**
 * 状态，`setState` 之后再渲染仍是 null，SSR 断言在这个项目里不可用。
 */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../stores/uiStore';
import type { TimeRecord } from '../../types/domain';
import { UndoBar } from './UndoBar';

/* React 19 的 act() 需要这个全局标记，否则每次 act 都会打一条 deprecation 警告 */
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const RECORD: TimeRecord = {
  id: 1,
  itemId: 1,
  status: 'saved',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_120_000,
  accumulatedSec: 125,
  runningSince: null,
  note: null,
  mode: 'countup',
  targetSec: null,
};

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<string> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(UndoBar));
  });
  return container.innerHTML;
}

describe('UndoBar —— 只有「已记录 + 撤销」一种形态', () => {
  beforeEach(() => {
    useUiStore.setState({ undoRecord: null, undoDeadline: null, endedAt: null, notice: null });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
  });

  it('没有可撤销记录时什么都不渲染', async () => {
    expect(await mount()).toBe('');
  });

  it('有记录时：文案含时长与事项名，且只有一个「撤销」按钮', async () => {
    useUiStore.setState({ undoRecord: RECORD, undoDeadline: Date.now() + 3000 });
    const html = await mount();

    expect(html).toContain('已记录');
    expect(html).toContain('02:05'); // formatDuration(125)
    expect(html).toContain('未归类'); // itemStore 为空时的兜底名
    expect(html).toContain('撤销');
    expect(html.match(/<button/g) ?? [], '二选一形态已删除，不该再有第二个按钮').toHaveLength(1);
  });

  it('根节点不再带 data-short（短记录视觉分支已随功能下架）', async () => {
    useUiStore.setState({ undoRecord: RECORD, undoDeadline: Date.now() + 3000 });
    expect(await mount()).not.toContain('data-short');
  });
});
