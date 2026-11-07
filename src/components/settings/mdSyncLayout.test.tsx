import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdBackupItem, MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* [V0.11.16] **结构断言**：这一轮做的是减法，「少了什么」必须有机器判据，否则下一轮
   又会长回来。五条来自 PRD 第九节：

   B1 ① 里「日记文件名」输入框只有 1 个（原 3 个），整块 4 个输入框
   D1 ③ 主路径只有 3 个可编辑控件（总开关 / 间隔 / 日记落点）
   D4 三档 root 不同 → 一行提示 + 「逐个设置」；**点开前不挂载那三行**；不点直接保存 → 三档一个不动
   D5 某档被关掉 → 「便利贴这一档已关闭同步。」→ 点开能看见档位开关
   F1/F2/F3 ⑤ 默认折叠、当条记录与列表第一条同源、空列表说「还没有备份。」 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault2', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

/* 三份底（时间戳按本地时区落在 11-07 22:14 / 11-06 17:05 / 11-03 15:00）：
   `latest` 必须是 atMs 最大的那条，且它与展开后列表第一条是同一份 */
const ITEMS: MdBackupItem[] = [
  { name: 'webdav__2026-11-06.md', target: 'webdav', source: '2026-11-06.md', date: '2026-11-06', atMs: 1793955900000, bytes: 8192 },
  { name: 'obsidian__2026-11-07.md', target: 'obsidian', source: '2026-11-07.md', date: '2026-11-07', atMs: 1794060840000, bytes: 3276 },
  { name: 'legacy.md', target: null, source: '2026-11-03.md', date: null, atMs: 1793689200000, bytes: 2048 },
];

function view(): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings: BINDINGS, cloud: null },
    cloud: { enabled: false, mode: 'localfolder', hasSecret: false, todayPushed: false, pendingDates: [], lastError: null },
    status: {
      lastSyncAt: null,
      lastError: null,
      bindings: [{
        kind: 'timers',
        path: 'C:\\Vault\\2026-11-07.md',
        exists: true,
        lastError: null,
        lastSyncAt: null,
        lastDirection: null,
      }],
    },
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
  await act(async () => { await Promise.resolve(); });
}

const block = (id: string) => container.querySelector(`[data-block="${id}"]`);
const button = (text: string): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
};

/** 块内**可编辑控件**：输入框 + 开关（`role="switch"` 的按钮） */
function editable(blockId: string): Element[] {
  const scope = block(blockId);
  if (!scope) return [];
  return [
    ...Array.from(scope.querySelectorAll('input')),
    ...Array.from(scope.querySelectorAll('[role="switch"]')),
  ];
}

describe('数据管理的结构（减法有没有真减掉）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue(ITEMS);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    api.get.mockResolvedValue(view());
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...view(), config }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('B1：① 只有 4 个输入框，其中「日记文件名」恰好 1 个', async () => {
    await mount();
    const fields = editable('data-format');
    expect(fields).toHaveLength(4);
    expect(container.querySelectorAll('[data-block="data-format"] input[aria-label="日记文件名"]')).toHaveLength(1);
  });

  it('D1：③ 主路径只有 3 个可编辑控件（总开关 / 间隔 / 日记落点）', async () => {
    await mount();
    const controls = editable('data-sync');
    expect(controls).toHaveLength(3);
    expect(controls.filter((el) => el.getAttribute('role') === 'switch')).toHaveLength(1);
    expect(container.querySelector('[data-block="data-sync"] input[aria-label="日记落点根目录"]')).not.toBeNull();
    /* 三档行在收起态**根本不挂载**（不是 hidden）：DOM 里一条「文件名与标题来自」都搜不到 */
    expect(container.querySelectorAll('.sync__card')).toHaveLength(0);
    expect(container.textContent).not.toContain('文件名与标题来自');
  });

  it('D4：三档 root 不同 → 一行提示 + 「逐个设置」；点开才出现三行', async () => {
    await mount();
    const hint = block('data-sync')?.querySelector('.sync__tier-hint');
    expect(hint?.textContent).toContain('三档落点不同：');
    /* 提示行只列不同项，且显示层截断、title 给全文 */
    expect(hint?.textContent).toContain('便利贴');
    expect(hint?.querySelector('.sync__tier-text')?.getAttribute('title')).toContain('%APP_DIR%\\md');

    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });
    expect(container.querySelectorAll('.sync__card')).toHaveLength(3);
    /* 展开后提示行不再重复，但出口还在（只有用户能收起） */
    expect(container.querySelector('.sync__tier-hint')).toBeNull();
    expect(button('收起逐个设置')).toBeTruthy();
  });

  it('D4：不点「逐个设置」直接保存 → 三档 root 一个没动（默认值不许盖回）', async () => {
    await mount();
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });

    const saved = api.save.mock.calls[0][0] as MdSyncViewCloud['config'];
    expect(saved.bindings.map((binding) => binding.root)).toEqual(BINDINGS.map((binding) => binding.root));
    expect(saved.bindings.map((binding) => binding.enabled)).toEqual(BINDINGS.map((binding) => binding.enabled));
    expect(saved.bindings.map((binding) => binding.file)).toEqual(BINDINGS.map((binding) => binding.file));
    expect(saved.bindings.map((binding) => binding.heading)).toEqual(BINDINGS.map((binding) => binding.heading));
  });

  it('D5：某档被关掉 → 出现「便利贴这一档已关闭同步。」，点开能重新打开', async () => {
    /* 便利贴那一档被关掉（等于用户用「逐个设置」把开关点掉了，或直接改过 JSON） */
    const closed = BINDINGS.map((binding, index) => (index === 1 ? { ...binding, enabled: false } : binding));
    api.get.mockResolvedValue({ ...view(), config: { ...view().config, bindings: closed } });
    await mount();

    const hint = block('data-sync')?.querySelector('.sync__tier-hint')?.textContent ?? '';
    expect(hint).toContain('便利贴这一档已关闭同步。');
    /* 关档优先于「三档落点不同」：一次只说一件事 */
    expect(hint).not.toContain('三档落点不同');

    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });
    const switches = Array.from(container.querySelectorAll('[data-block="data-sync"] [role="switch"]'));
    expect(switches).toHaveLength(4); /* 总开关 + 3 个档位开关 */
    /* 关掉的那一档在行上显示为 off（`aria-checked="false"`），输入框仍在——可以改回来 */
    expect(switches.filter((el) => el.getAttribute('aria-checked') === 'false')).toHaveLength(1);
    expect(container.querySelectorAll('.sync__card')).toHaveLength(3);
  });

  it('D2：新装 → 落点框是 %APP_DIR%\\md，今天那行是后端给的绝对路径，且没有异常态入口', async () => {
    const fresh: MdSyncBinding[] = [
      { kind: 'timers', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 事项计时' },
      { kind: 'notes', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 便利贴' },
      { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
    ];
    const base = view();
    api.get.mockResolvedValue({
      ...base,
      config: { ...base.config, bindings: fresh },
      status: {
        ...base.status,
        bindings: [{
          kind: 'timers',
          path: 'D:\\Timing\\data\\md\\2026-11-07.md',
          exists: false,
          lastError: null,
          lastSyncAt: null,
          lastDirection: null,
        }],
      },
    });
    await mount();

    const root = container.querySelector(
      '[data-block="data-sync"] input[aria-label="日记落点根目录"]',
    ) as HTMLInputElement;
    expect(root.value).toBe('%APP_DIR%\\md');
    /* 「默认在该应用文件夹内」的证据：绝对路径由后端展开（前端不实现第二套令牌口径） */
    expect(block('data-sync')?.querySelector('.sync__path')?.textContent)
      .toBe('今天：D:\\Timing\\data\\md\\2026-11-07.md');
    /* 三档一致 → 新装用户看不到任何异常态提示 */
    expect(container.querySelector('.sync__tier-hint')).toBeNull();
    expect(button('打开今日文件').disabled).toBe(false);
  });

  it('F1/F2：⑤ 默认折叠，标题下那行是「最近一份」（与列表第一条同源）', async () => {
    await mount();
    const toggle = block('data-backup')?.querySelector('.sync__fold-btn');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    const latest = block('data-backup')?.querySelector('.sync__latest');
    expect(latest?.textContent).toBe('最近：11-07 22:14 · 覆盖前备份 · 2026-11-07.md · 3.2 KB');
    /* 展开后列表第一条说的是同一份（同一个 `items` 数组） */
    expect(container.textContent).toContain('2026-11-07.md');
    /* `md_backup_list` 每次打开设置页只调一次（当条记录与列表共用一份） */
    expect(backupApi.list).toHaveBeenCalledTimes(1);
  });

  it('F3：一份备份都没有时，那一行显示「还没有备份。」', async () => {
    backupApi.list.mockResolvedValue([]);
    await mount();
    expect(block('data-backup')?.querySelector('.sync__latest')?.textContent).toBe('还没有备份。');
  });
});
