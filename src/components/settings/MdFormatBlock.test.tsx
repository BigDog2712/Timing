import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { NO_SHARED } from './mdSyncShared';
import type { MdSyncShared } from './mdSyncShared';

/* [V0.11.16] 块①（Markdown 落点设置）改成一个日记文件：
   B1（只有 1 个文件名框 + 3 个标题行）、B3（三个标题各显示自己的值）、
   B4 的显示侧（三档 file 不同 → 显示计时档 + 一行灰字）。
   B2 / B4 的保存行为在 `mdSyncShared.test.ts`（`applyShared` 恒等 + 扇出）。 */

const SAME_FILE: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 便利贴②' },
  { kind: 'todos', enabled: false, root: 'C:\\Vault', file: '{date}.md', heading: '#### 待办事项③' },
];

const MIXED_FILE: MdSyncBinding[] = [
  { ...SAME_FILE[0], file: 'Diary/{date}.md' },
  { ...SAME_FILE[1], file: '{date}-notes.md' },
  SAME_FILE[2],
];

function view(bindings: MdSyncBinding[]): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings, cloud: null },
    cloud: { enabled: false, mode: 'localfolder', hasSecret: false, todayPushed: false, pendingDates: [], lastError: null },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

const updateBinding = vi.fn();
const setSharedFile = vi.fn();

/** 块①只读 `draft` 的几个字段：给一个最小替身，别的字段不参与本块 */
function draftOf(
  bindings: MdSyncBinding[],
  options: { error?: string | null; shared?: MdSyncShared } = {},
): MdSyncDraft {
  return {
    bindings,
    shared: options.shared ?? NO_SHARED,
    saving: false,
    loading: false,
    error: options.error ?? null,
    updateBinding,
    setSharedFile,
  } as unknown as MdSyncDraft;
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

const inputs = () => Array.from(container.querySelectorAll('input'));
const input = (label: string) => container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;

describe('MdFormatBlock —— ① 一个日记文件 + 三段标题', () => {
  beforeEach(() => {
    updateBinding.mockReset();
    setSharedFile.mockReset();
    useMdSyncStore.setState({ view: view(SAME_FILE), loaded: true, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('B1：整块只有 4 个输入框（文件名 1 + 标题 3），「日记文件名」恰好 1 个', async () => {
    await mount(draftOf(SAME_FILE));
    expect(inputs()).toHaveLength(4);
    expect(inputs().filter((item) => item.getAttribute('aria-label') === '日记文件名')).toHaveLength(1);
    expect(container.querySelectorAll('.sync__heading-row')).toHaveLength(3);
    /* 旧的「文件模板」标签与三档指路行都不许再回来（PRD A2 / C4 / C5） */
    expect(container.textContent).not.toContain('文件模板');
    expect(container.textContent).not.toContain('文件放在哪个目录');
  });

  it('文件名框右侧只有一行「今天：…」（3 处收成 1 处，C7）', async () => {
    await mount(draftOf(SAME_FILE));
    const today = container.querySelectorAll('.sync__today');
    expect(today).toHaveLength(1);
    expect(today[0].textContent).toBe('今天：2026-11-07.md');
    /* 令牌展开仍在（`{date}` → 今天），只是不再逐档说三遍 */
    expect(container.textContent).not.toContain('今天会写成');
  });

  it('B3：三个标题行各显示自己的值，一个都没被默认值盖回', async () => {
    await mount(draftOf(SAME_FILE));
    expect(input('事项计时标题行')?.value).toBe('#### 事项计时');
    expect(input('便利贴标题行')?.value).toBe('#### 便利贴②');
    expect(input('待办事项标题行')?.value).toBe('#### 待办事项③');
  });

  it('改文件名只写统一意图（setSharedFile），不直接改三档', async () => {
    await mount(draftOf(SAME_FILE));
    const field = input('日记文件名') as HTMLInputElement;
    await setValue(field, '{date}-asd.md');

    expect(setSharedFile).toHaveBeenCalledWith('{date}-asd.md');
    expect(updateBinding).not.toHaveBeenCalled();
  });

  it('改标题行把 part 标成 format（脏标记要落到块①而不是块③）', async () => {
    await mount(draftOf(SAME_FILE));
    await setValue(input('便利贴标题行') as HTMLInputElement, '#### 便利贴（改）');

    expect(updateBinding).toHaveBeenCalledWith(1, { ...SAME_FILE[1], heading: '#### 便利贴（改）' }, 'format');
  });

  it('B4 显示侧：三档 file 不同 → 显示计时档 + 一行灰字（不静默统一）', async () => {
    await mount(draftOf(MIXED_FILE));
    expect(input('日记文件名')?.value).toBe('Diary/{date}.md');
    const hint = container.querySelector('[data-mixed="true"]')?.textContent ?? '';
    expect(hint).toContain('便利贴');
    expect(hint).toContain('待办事项');
    expect(hint).toContain('改上面的名字会三档统一');
    /* 三档一致时不出这行灰字 */
    await act(async () => { root.unmount(); });
    container.remove();
    await mount(draftOf(SAME_FILE));
    expect(container.querySelector('[data-mixed="true"]')).toBeNull();
  });

  it('单框显示的是「意图」而不是三档里的某一档（用户刚改过的值不能被回填冲掉）', async () => {
    await mount(draftOf(MIXED_FILE, { shared: { file: '{date}-new.md', root: null } }));
    expect(input('日记文件名')?.value).toBe('{date}-new.md');
    expect(container.textContent).toContain('今天：2026-11-07-new.md');
  });

  it('文件名为空时不给假的预览', async () => {
    await mount(draftOf([{ ...SAME_FILE[0], file: '', heading: '' }]));
    expect(container.textContent).toContain('（还没填文件名）');
    expect(container.textContent).toContain('这一行还没填完。');
  });

  it('后端的「第 N 个落点：…」原文只落在第 N 行下方', async () => {
    await mount(draftOf(SAME_FILE, { error: '第 2 个落点：标题行必须以 # 开头' }));
    const rows = Array.from(container.querySelectorAll('.sync__heading-row'));
    expect(rows[0].querySelector('.sync__error')).toBeNull();
    expect(rows[1].querySelector('.sync__error')?.textContent).toBe('标题行必须以 # 开头');
  });

  it('A3：块末只留一句安全提示，全块「日记其他内容不动」恰好 1 处', async () => {
    await mount(draftOf(SAME_FILE));
    const notes = Array.from(container.querySelectorAll('.data__note')).map((el) => el.textContent ?? '');
    expect(notes).toContain('只改这三个标题下面的内容，日记其他内容不动。');
    expect(container.textContent?.split('日记其他内容不动').length).toBe(2);
  });

  it('没有落点时给空态文案（沿用 v0.11.14 的说法）', async () => {
    await mount(draftOf([]));
    expect(container.textContent).toContain('没有可配置的落点。');
  });
});
