(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/**
 * Timing — 设置 · 同步 · 日记模板路径的「选择文件…」（[设置页七项改造·批 3]）
 * -----------------------------------------------------------------------------
 * 这一颗键的判据不是「按钮在不在」，而是**它走的是不是同一条落库路径**：
 *
 *   点按钮 → 选文件 → 输入框出现路径 → 「保存并同步」落库 → 重开仍在
 *
 * 中间任何一段另起炉灶都会造成同一种症状：框里有值、点保存却什么都没存下来
 * （`MdFormatBlock` 的草稿只有一个写入口 `setDiaryTemplate`，保存载荷也从那里取）。
 * 所以这里钉三件事：
 *   1. 选到文件 → 写 `setDiaryTemplate(路径)`，且只写一次；
 *   2. 取消 / 浏览器 mock / 命令失败（统一回 `null`）→ **一次都不写**，原值保留
 *      （写成空串等于「点一下取消就把模板清空了」）；
 *   3. `saving` 时按钮禁用，`picking` 期间文案变「选择中…」（防连点叠两个原生对话框）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pickMarkdownFile = vi.fn<() => Promise<string | null>>();

vi.mock('../../../../platform/storage/storageRuntimeGateway', () => ({
  pickMarkdownFile: () => pickMarkdownFile(),
}));

import { MdFormatBlock } from './MdFormatBlock';
import type { MdSyncDraft } from '../../services/host/useMdSyncDraft';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  pickMarkdownFile.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

/** 只给 `MdFormatBlock` 真正读到的字段；其余由类型断言补齐（不伪造行为）。 */
function draft(overrides: Partial<{ saving: boolean; diaryTemplate: string }> = {}) {
  const setDiaryTemplate = vi.fn<(value: string) => void>();
  const value = {
    bindings: [{ kind: 'timers' as const, file: '{date}.md', root: 'C:\\md', heading: '### 计时', enabled: true }],
    shared: { file: null, root: null },
    saving: overrides.saving ?? false,
    loading: false,
    error: null,
    updateBinding: vi.fn(),
    setSharedFile: vi.fn(),
    setDiaryTemplate,
    diaryTemplate: overrides.diaryTemplate ?? '',
  } as unknown as MdSyncDraft;
  return { value, setDiaryTemplate };
}

function mount(value: MdSyncDraft): void {
  act(() => root.render(createElement(MdFormatBlock, { draft: value })));
}

function pickButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((node) => (node.textContent ?? '').includes('选择文件'));
  if (!button) throw new Error('找不到「选择文件…」按钮');
  return button;
}

async function clickAndFlush(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('日记模板路径 · 选择文件', () => {
  it('pf01_the_pick_writes_the_path_into_the_same_draft_field', async () => {
    const { value, setDiaryTemplate } = draft();
    pickMarkdownFile.mockResolvedValue('C:\\Templates\\日记.md');
    mount(value);

    await clickAndFlush(pickButton());

    expect(pickMarkdownFile).toHaveBeenCalledTimes(1);
    expect(setDiaryTemplate, '选到的路径没写进草稿 → 点保存等于没选').toHaveBeenCalledTimes(1);
    expect(setDiaryTemplate).toHaveBeenCalledWith('C:\\Templates\\日记.md');
  });

  it('pf02_cancelling_keeps_the_original_value', async () => {
    const { value, setDiaryTemplate } = draft({ diaryTemplate: 'C:\\Templates\\旧模板.md' });
    /* 取消 / 浏览器 mock / 命令失败在网关层是一个值：null */
    pickMarkdownFile.mockResolvedValue(null);
    mount(value);

    await clickAndFlush(pickButton());

    expect(setDiaryTemplate, '取消选择把原值清空了').not.toHaveBeenCalled();
  });

  it('pf03_the_key_is_disabled_while_saving', () => {
    const { value } = draft({ saving: true });
    mount(value);

    expect(pickButton().disabled, 'saving 时还能点开原生对话框').toBe(true);
  });
});
