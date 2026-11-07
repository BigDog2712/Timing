import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* [V0.11.15] 块①（Markdown 落点设置）的口径：只读预览、子目录提示、行内错误、
   以及「改的是 format 这一半」。③ 的根目录不在这里测（见 MdSyncTab.test 的镜像用例）。 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: 'Diary/{yyyy}/{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault', file: '', heading: '#### 便利贴' },
];

function view(bindings: MdSyncBinding[]): MdSyncViewCloud {
  return {
    today: '2026-10-20',
    config: { enabled: true, pollSecs: 900, bindings, cloud: null },
    cloud: { enabled: false, mode: 'localfolder', hasSecret: false, todayPushed: false, pendingDates: [], lastError: null },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

const updateBinding = vi.fn();

/** 块①只读 `draft` 的几个字段：给一个最小替身，别的字段不参与本块 */
function draftOf(bindings: MdSyncBinding[], error: string | null = null): MdSyncDraft {
  return { bindings, saving: false, loading: false, error, updateBinding } as unknown as MdSyncDraft;
}

import { MdFormatBlock } from './MdFormatBlock';
import type { MdSyncDraft } from './useMdSyncDraft';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(draft: MdSyncDraft): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MdFormatBlock, { draft }));
    await Promise.resolve();
  });
}

async function setValue(target: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置 input value');
  await act(async () => {
    setter.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('MdFormatBlock —— ① Markdown 落点设置', () => {
  beforeEach(() => {
    updateBinding.mockReset();
    useMdSyncStore.setState({ view: view(BINDINGS), loaded: true, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
  });

  it('把模板里的日期令牌展开成今天，并说清会建哪个子目录（PRD 4.1「今天会写成」）', async () => {
    await mount(draftOf(BINDINGS));
    expect(container.textContent).toContain('今天会写成：Diary/2026/2026-10-20.md');
    expect(container.textContent).toContain('会建子目录 Diary/2026');
  });

  it('每行末尾都有指路行：目录不在这里改（拆分带来的唯一代价）', async () => {
    await mount(draftOf(BINDINGS));
    const hints = Array.from(container.querySelectorAll('.data__note'))
      .filter((el) => el.textContent?.includes('文件放在哪个目录'));
    expect(hints).toHaveLength(BINDINGS.length);
  });

  it('改文件模板时把 part 标成 format（脏标记要落到块①而不是块③）', async () => {
    await mount(draftOf(BINDINGS));
    const field = container.querySelector('input[aria-label="事项计时文件模板"]') as HTMLInputElement;
    await setValue(field, 'Journal/{date}.md');

    expect(updateBinding).toHaveBeenCalledWith(
      0,
      { ...BINDINGS[0], file: 'Journal/{date}.md' },
      'format',
    );
  });

  it('模板为空时不给假的预览，并且提示这一行没填完', async () => {
    await mount(draftOf(BINDINGS));
    expect(container.textContent).toContain('（文件模板为空）');
    expect(container.textContent).toContain('这一行还没填完。');
  });

  it('后端的「第 N 个落点：…」原文只落在第 N 行下方，不糊到第一行', async () => {
    await mount(draftOf(BINDINGS, '第 2 个落点：文件模板不能包含 ..'));
    const rows = Array.from(container.querySelectorAll('.sync__fields'));
    expect(rows[0].querySelector('.sync__error')).toBeNull();
    expect(rows[1].querySelector('.sync__error')?.textContent).toBe('文件模板不能包含 ..');
  });

  it('没有落点时给空态文案（沿用 v0.11.14 的说法）', async () => {
    await mount(draftOf([]));
    expect(container.textContent).toContain('没有可配置的落点。');
  });
});
