import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { COPY } from './mdSyncCopy';

/* [V0.11.16] PRD A1 的**逐块行数**判据（DOM 层，不是常量层）。

   为什么单独一个文件：`mdSyncCopy.test.ts` 只能证明「九句常量抄得对」，
   `MdSyncTab.test.tsx` 的 A1 只数了 ②③④⑤ 四块的 `.data__block-hint`——① 被排除在外
   （它例外地有 3 行）。而 ① 恰好是本轮改动最大的一块（6 个输入框 → 4 个），
   「① 还是不是 3 行、有没有又长回第 4 行」必须有人数。

   用**新装用户形状**（三档 root / file 全同）：此时 ① 的灰色「三档文件名不同」提示
   不出现，正好是 PRD A1 描述的那个正常态。老用户 mixed 态多一行是 PRD 4.1 明确要求的
   （「框下补一行灰字」），不算违规——`mdSyncNoTouch.test.tsx` 已覆盖那一态。 */

const UNIFORM: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

function view(bindings: MdSyncBinding[]): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings, cloud: null },
    cloud: { enabled: false, mode: 'localfolder', hasSecret: false, todayPushed: false, pendingDates: [], lastError: null },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

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
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const block = (id: string) => container.querySelector(`[data-block="${id}"]`);

describe('A1：五块的说明行数（① 3 行，②~⑤ 各 1 行）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(view(UNIFORM));
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...view(UNIFORM), config }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('②③④⑤ 标题下各只有一句（逐字等于 COPY 里那一句）', async () => {
    await mount();
    expect(block('data-root')?.querySelectorAll('.data__block-hint')).toHaveLength(1);
    expect(block('data-root')?.querySelector('.data__block-hint')?.textContent).toBe(COPY.dataRootHint);
    expect(block('data-sync')?.querySelectorAll('.data__block-hint')).toHaveLength(1);
    expect(block('data-sync')?.querySelector('.data__block-hint')?.textContent).toBe(COPY.syncHint);
    expect(block('data-cloud')?.querySelectorAll('.data__block-hint')).toHaveLength(1);
    expect(block('data-cloud')?.querySelector('.data__block-hint')?.textContent).toBe(COPY.cloudHint);
    expect(block('data-backup')?.querySelectorAll('.data__block-hint')).toHaveLength(1);
    expect(block('data-backup')?.querySelector('.data__block-hint')?.textContent).toBe(COPY.backupHint);
  });

  it('① 例外地有 3 行：标题下一句 + 文件名框下一行小字 + 块末一句安全提示', async () => {
    await mount();
    const format = block('data-format');
    expect(format?.querySelector('.data__block-hint')?.textContent).toBe(COPY.formatHint);
    /* C6：文件名框下那行小字 */
    expect(format?.querySelectorAll('.sync__hint')).toHaveLength(1);
    expect(format?.querySelector('.sync__hint')?.textContent).toBe(COPY.fileTemplateNote);
    /* C8：块末唯一的安全句 */
    expect(format?.querySelectorAll('.data__note')).toHaveLength(1);
    expect(format?.querySelector('.data__note')?.textContent).toBe(COPY.safeNote);
    /* 三档同名时不出现那行灰字提示（→ 恰好 3 行） */
    expect(format?.querySelector('[data-mixed="true"]')).toBeNull();
  });

  it('页签顶部没有导览句、底部没有注脚（C1 / C2 整段删除）', async () => {
    await mount();
    const head = container.querySelector('.data__head');
    expect(head?.textContent).toBe('数据管理');
    expect(head?.querySelector('.data__hint')).toBeNull();
    const page = container.querySelector('.data') as HTMLElement;
    /* 页签层（`:scope >`）不能有任何注脚；块里的 `.data__note` 不受影响 */
    expect(page.querySelectorAll(':scope > .data__note')).toHaveLength(0);
    expect(page.querySelectorAll(':scope > .data__hint')).toHaveLength(0);
  });
});
