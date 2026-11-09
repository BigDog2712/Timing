import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* [V0.11.33] 日记模板配置链路的判据（30-PRD P15 + P19 前端半）。
 * -----------------------------------------------------------------------------
 * F10–F14 的落点在设置页块①：「日记模板路径」输入框（aria 逐字 W8，不加 hint）；
 * 保存载荷恒带 `diaryTemplate` 字符串，空串由后端 skip 不落盘（P19 零 diff）。
 * Rust 半（落库读回 / 读不改盘 / 模板落地）在 `src-tauri/src/tests/md_diary_template.rs`。
 *
 * 用真 `MdSyncTab` 走完整链路（不拿替身 draft 自证），mock 只替传输层。 */

const UNIFORM: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

/** 未配置形状：config 里**没有** `diaryTemplate` 键（老用户 / 新装同形） */
function view(diaryTemplate?: string): MdSyncViewCloud {
  return {
    today: '2026-11-09',
    config: {
      enabled: true,
      pollSecs: 900,
      bindings: UNIFORM,
      diaryTemplate,
      cloud: null,
    },
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

async function mount(initial: MdSyncViewCloud): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockResolvedValue(initial);
  api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...initial, config }));
  await act(async () => {
    root.render(createElement(MdSyncTab));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

async function setValue(target: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置 input value');
  await act(async () => {
    setter.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const templateInput = () =>
  container.querySelector('input[aria-label="日记模板路径"]') as HTMLInputElement | null;
const button = (text: string): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
};
const block = (id: string) => container.querySelector(`[data-block="${id}"]`);

describe('日记模板配置链路（P15 / P19 前端半）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run, api.test]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
    rootApi.get.mockReset();
    rootApi.get.mockResolvedValue(DATA_ROOT);
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('P15：输入框存在、aria 逐字「日记模板路径」、未配置时空值', async () => {
    await mount(view());
    const input = templateInput();
    expect(input).not.toBeNull();
    expect(input?.value).toBe('');
    /* 位置：块①（写成什么样的一部分），不在块③④⑤ */
    expect(block('data-format')?.contains(input)).toBe(true);
  });

  it('P15/P19：已配置的值回填到输入框；改动记在块①（「未保存」亮在块①）', async () => {
    await mount(view('%APP_DIR%\\模板.md'));
    expect(templateInput()?.value).toBe('%APP_DIR%\\模板.md');

    await setValue(templateInput() as HTMLInputElement, '%APP_DIR%\\模板2.md');
    expect(block('data-format')?.querySelector('.data__dirty')?.textContent).toBe('未保存');
    expect(container.querySelector('.data__bar-hint')?.textContent).toBe('有未保存的修改');
    /* 放弃修改回滚（与其它块①字段同一条回填路径） */
    await act(async () => { button('放弃修改').click(); await Promise.resolve(); });
    expect(templateInput()?.value).toBe('%APP_DIR%\\模板.md');
  });

  it('P19：保存载荷恒带 diaryTemplate（新值随 md_sync_save 落库；读回一致）', async () => {
    await mount(view());
    await setValue(templateInput() as HTMLInputElement, 'D:\\Vault\\Templates\\日记模板.md');
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });

    const saved = api.save.mock.calls[0][0] as MdSyncViewCloud['config'];
    expect(saved.diaryTemplate).toBe('D:\\Vault\\Templates\\日记模板.md');

    /* 读回：mock 后端按保存值返回 → store 里的 view 回填同样的值（roundtrip 一致） */
    const reread = useMdSyncStore.getState().view;
    expect(reread?.config.diaryTemplate).toBe('D:\\Vault\\Templates\\日记模板.md');
    expect(templateInput()?.value).toBe('D:\\Vault\\Templates\\日记模板.md');
  });

  it('P19：未配置时保存载荷带空串（后端 skip 不落盘），其余字段一个字节不动', async () => {
    await mount(view());
    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });

    const saved = api.save.mock.calls[0][0] as MdSyncViewCloud['config'];
    expect(saved.diaryTemplate).toBe('');
    /* 读不改盘 + 零 diff 的前端半：没改任何东西，落点与通路原样透传 */
    expect(saved.bindings.map((binding) => binding.root)).toEqual(UNIFORM.map((binding) => binding.root));
    expect(saved.pollSecs).toBe(900);
    expect(saved.enabled).toBe(true);
  });
});
