import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { REMOVED_PHRASES } from './mdSyncCopy';

/* [V0.11.15] 本文件只测**壳**：五块顺序 / 折叠 aria / 底部条 / 脏标记归属 / 保存。
   每块的字段口径在自己那份测试里（`MdFormatBlock.test.tsx` / `MdDataRootBlock.test.tsx`）。 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 便利贴' },
];

const VIEW: MdSyncViewCloud = {
  today: '2026-10-20',
  config: { enabled: true, pollSecs: 900, bindings: BINDINGS, cloud: null, cloudFolder: null, cloudWebdav: null },
  cloud: {
    enabled: false,
    mode: 'webdav',
    hasSecret: false,
    todayPushed: false,
    pendingDates: [],
    lastError: null,
  },
  local: {
    enabled: false,
    mode: 'localfolder',
    hasSecret: false,
    todayPushed: false,
    pendingDates: [],
    lastError: null,
  },
  status: {
    lastSyncAt: null,
    lastError: null,
    bindings: BINDINGS.map((binding) => ({
      kind: binding.kind,
      path: `C:\\Vault\\2026-10-20.md`,
      exists: true,
      lastError: null,
      lastSyncAt: null,
      lastDirection: null,
    })),
  },
};

const DATA_ROOT: DataRootInfo = {
  current: 'D:\\Timing\\data',
  defaultPath: 'C:\\Program Files\\Timing\\data',
  isDefault: false,
  writable: true,
  writableError: null,
  pending: null,
  previous: null,
  sizeBytes: 2048,
  entries: [],
  affected: [],
  pluginsInDataRoot: false,
};

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), run: vi.fn(), open: vi.fn(), test: vi.fn() }));
const backupApi = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn(), open: vi.fn() }));
const rootApi = vi.hoisted(() => ({ get: vi.fn(), change: vi.fn(), open: vi.fn() }));

vi.mock('../../services/api', () => ({
  mdSyncApi: api,
  mdBackupApi: backupApi,
  dataRootApi: rootApi,
  /* 真 `errorText` 是传输层那个码→人话的映射；这里只需要「能渲染出一句话」这一层 */
  errorText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
  rawIpcText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
}));

import { MdSyncTab } from './MdSyncTab';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MdSyncTab));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

async function setValue(target: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置 input value');
  await act(async () => {
    setter.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const block = (id: string) => container.querySelector(`[data-block="${id}"]`);
const input = (label: string) => container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
const barHint = () => container.querySelector('.data__bar-hint')?.textContent;

describe('MdSyncTab —— 数据管理页签壳', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.save.mockReset();
    api.run.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(VIEW);
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...VIEW, config }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
  });

  it('页签标题是「数据管理」，六块按固定顺序排列（PRD O7 / 设计 §1.4）', async () => {
    await mount();
    expect(container.querySelector('.data__title')?.textContent).toBe('数据管理');
    expect(Array.from(container.querySelectorAll('.data__block-title')).map((el) => el.textContent))
      .toEqual([
        'Markdown 落点设置',
        'SQLite 落点设置',
        'Markdown 同步',
        /* [V0.11.33] 块④⑤标题加 WebDAV 前缀（W1/W2 / P1，主人原话逐字） */
        'WebDAV 本地同步',
        'WebDAV 云端同步',
        '备份数据管理',
      ]);
  });

  it('每块的 chevron 都能收起/展开，默认全部收起且收起时 body 是 hidden（PRD O4）', async () => {
    await mount();
    const toggle = block('data-format')?.querySelector('.sync__fold-btn') as HTMLButtonElement;
    const bodyId = toggle.getAttribute('aria-controls') as string;
    expect(container.querySelector(`#${bodyId}`)).not.toBeNull();
    /* [V0.11.26] 六块默认折叠（O4）：首帧一律 `aria-expanded=false` */
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector(`#${bodyId}`)?.hasAttribute('hidden')).toBe(true);

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector(`#${bodyId}`)?.hasAttribute('hidden')).toBe(false);
  });

  it('改①的标题行只在块①出现「未保存」，底部条同时出现；「放弃修改」回滚（PRD A4）', async () => {
    await mount();
    const heading = input('便利贴标题行');
    if (!heading) throw new Error('找不到块①的标题行输入框');
    await setValue(heading, '#### 便利贴（改过）');

    expect(block('data-format')?.querySelector('.data__dirty')?.textContent).toBe('未保存');
    /* ①和③共用同一个 bindings 数组：脏标记必须按「谁动的」记，否则这一条会红 */
    expect(block('data-sync')?.querySelector('.data__dirty')).toBeNull();
    expect(barHint()).toBe('有未保存的修改');
    expect(button('立即同步').disabled).toBe(true);

    await act(async () => {
      button('放弃修改').click();
      await Promise.resolve();
    });

    expect(input('便利贴标题行')?.value).toBe('#### 便利贴');
    expect(container.querySelector('.data__dirty')).toBeNull();
    expect(barHint()).toBe('');
    expect(button('放弃修改').disabled).toBe(true);
    expect(button('立即同步').disabled).toBe(false);
  });

  it('改③的根目录只在块③出现「未保存」（与上一条互为镜像）', async () => {
    await mount();
    const target = input('日记落点根目录');
    if (!target) throw new Error('找不到块③的日记落点输入框');
    await setValue(target, 'D:\\NewVault');

    expect(block('data-sync')?.querySelector('.data__dirty')?.textContent).toBe('未保存');
    expect(block('data-format')?.querySelector('.data__dirty')).toBeNull();
  });

  it('五块里只有一个「保存」按钮，且在底部 sticky 条里（PRD A6）', async () => {
    await mount();
    const saves = Array.from(container.querySelectorAll('button'))
      .filter((el) => el.textContent?.includes('保存'));
    expect(saves).toHaveLength(1);
    expect(container.querySelector('.data__bar')?.contains(saves[0])).toBe(true);
  });

  it('「保存并同步」把草稿交给后端，成功后「未保存」与底部提示一起消失', async () => {
    await mount();
    const target = input('日记落点根目录');
    if (!target) throw new Error('找不到块③的日记落点输入框');
    await setValue(target, 'D:\\NewVault');

    await act(async () => {
      button('保存并同步').click();
      await Promise.resolve();
    });

    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        pollSecs: 900,
        /* [V0.11.16] 单框写三档：两档原本同值（`C:\\Vault`），用户手改了 → 一起变成新值 */
        bindings: [
          { ...BINDINGS[0], root: 'D:\\NewVault' },
          { ...BINDINGS[1], root: 'D:\\NewVault' },
        ],
      }),
      /* 没碰密码框 → `undefined`（不动已存密文） */
      undefined,
    );
    expect(container.textContent).toContain('已保存并同步');
    expect(container.querySelector('.data__dirty')).toBeNull();
    expect(barHint()).toBe('');
  });

  /* ===== [V0.11.16] 文案减法的机器判据（PRD A1 / A2 / A3）===== */

  it('A1：页签顶部没有导览句、底部没有注脚，六块标题下各只有一句', async () => {
    await mount();
    expect(container.querySelector('.data__head')?.textContent).toBe('数据管理');
    /* 底部注脚（C2：「今天：…。同步只改目标标题下的区块，日记其他内容不动。」）整段删除：
       块①里那句 `.data__note` 是 C8 的安全句，只能留在块里，不能再出现在页签层 */
    const page = container.querySelector('.data') as HTMLElement;
    expect(page.querySelector(':scope > .data__note')).toBeNull();
    for (const id of ['data-root', 'data-sync', 'data-local', 'data-cloud', 'data-backup']) {
      expect(block(id)?.querySelectorAll('.data__block-hint')).toHaveLength(1);
    }
  });

  it('A2：三句被删掉的话全页零命中（含④⑤的折叠体，它们仍然挂载）', async () => {
    await mount();
    const text = container.textContent ?? '';
    for (const phrase of REMOVED_PHRASES) {
      expect(text).not.toContain(phrase);
    }
  });

  it('A3：「日记其他内容不动」全页恰好 1 处（块①末句），同一句话说三遍的毛病已收掉', async () => {
    await mount();
    const text = container.textContent ?? '';
    expect(text.split('日记其他内容不动').length - 1).toBe(1);
  });

  it('保存失败且能定位到落点时，红字落在块里，页签顶部不再重复一遍', async () => {
    api.save.mockRejectedValue(new Error('第 2 个落点：标题行必须以 # 开头'));
    await mount();
    await act(async () => {
      button('保存并同步').click();
      await Promise.resolve();
    });

    const inline = Array.from(block('data-format')?.querySelectorAll('.sync__error') ?? []);
    expect(inline.map((el) => el.textContent)).toContain('标题行必须以 # 开头');
    /* 顶部只剩「保存动作本身」的失败，落点级别的原文不在这里（PRD 六·通用规则） */
    const top = container.querySelector('.data') as HTMLElement;
    expect(top.querySelector(':scope > .sync__error')).toBeNull();
  });
});
