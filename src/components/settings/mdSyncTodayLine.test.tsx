import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { useMdSyncStore } from '../../stores/mdSyncStore';

/* [QA G1] ③ 那行「今天：… / 保存后：…」的判据。

   v0.11.16 首版把「草稿是否等于基准档」当成「草稿是否等于已落库」——而基准档也在草稿里，
   于是逐档手改之后两者恒等，`保存后：` 成了死代码。用户看到同一屏两处路径自相矛盾：
   上面那行「今天：C:\Vault\…」（后端旧值），紧挨着的逐档行「D:\x\…」。

   这两条用例单开一个文件而不是塞进 `mdSyncLayout.test.tsx`：那个文件 260 行，再加 55 行
   会撞 300 行门禁（`check:size` 零豁免）。harness 与它同形，改口径时两边一起看。 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault2', file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

/** 后端已落库的 `timers` 那一档路径（`今天：` 分支用它） */
function view(timersPath = 'C:\\Vault\\2026-11-07.md'): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings: BINDINGS, cloud: null },
    cloud: { enabled: false, mode: 'localfolder', hasSecret: false, todayPushed: false, pendingDates: [], lastError: null },
    status: {
      lastSyncAt: null,
      lastError: null,
      bindings: [{
        kind: 'timers',
        path: timersPath,
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
const pathLine = () => block('data-sync')?.querySelector('.sync__path')?.textContent ?? '';

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

/** 受控输入框要绕过 React 的 value 描述符才能触发 onChange */
async function setValue(target: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置 input value');
  await act(async () => {
    setter.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

const singleRoot = () =>
  block('data-sync')?.querySelector('input[aria-label="日记落点根目录"]') as HTMLInputElement;

describe('③「今天 / 保存后」那行（QA G1）', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run]) fn.mockReset();
    backupApi.list.mockReset();
    backupApi.list.mockResolvedValue([]);
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

  it('没改过 → 「今天：」用的是后端给的绝对路径', async () => {
    await mount();
    expect(pathLine()).toBe('今天：C:\\Vault\\2026-11-07.md');
  });

  it('逐档改过之后必须说「保存后」，不是旧路径的「今天」', async () => {
    await mount();
    expect(pathLine()).toBe('今天：C:\\Vault\\2026-11-07.md');

    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });
    const timersRow = Array.from(container.querySelectorAll('.sync__card'))
      .find((card) => card.querySelector('.sync__kind')?.textContent === '事项计时');
    const timersRoot = timersRow?.querySelector('input') as HTMLInputElement;
    expect(timersRoot.value).toBe('C:\\Vault');

    /* 逐档把事项计时改成 D:\x（它是单框的基准档，单框跟着变） */
    await setValue(timersRoot, 'D:\\x');

    /* 首版判据是 `root === base.root`，而 `base` 也在草稿里 → 恒等 → 永远说
       「今天：C:\Vault\…」，与紧挨着的逐档行「D:\x\…」自相矛盾。现在比的是**已落库**那档。 */
    expect(pathLine()).toBe('保存后：D:\\x\\2026-11-07.md');
    expect(pathLine()).not.toContain('C:\\Vault');
    /* 单框同步显示新值（基准档就是它） */
    expect(singleRoot().value).toBe('D:\\x');
  });

  it('保存之后回到「今天」，且用的是保存后的新路径', async () => {
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({
      ...view('D:\\x\\2026-11-07.md'),
      config,
    }));
    await mount();

    /* 走单框（统一意图，三档一起统一）→ 保存前是「保存后」 */
    await setValue(singleRoot(), 'D:\\x');
    expect(pathLine()).toBe('保存后：D:\\x\\2026-11-07.md');

    await act(async () => { button('保存并同步').click(); await Promise.resolve(); });
    /* 落库后草稿 == 已落库 → 回到「今天」，路径是后端重新算的那条 */
    expect(pathLine()).toBe('今天：D:\\x\\2026-11-07.md');
  });

  it('只改文件名也算「与已落库不同」（`same` 判的是两字段，不只 root）', async () => {
    await mount();
    await setValue(
      block('data-format')?.querySelector('input[aria-label="日记文件名"]') as HTMLInputElement,
      '{date}-asd.md',
    );
    expect(pathLine()).toBe('保存后：C:\\Vault\\2026-11-07-asd.md');
  });

  /* ===== 反向风险（QA 点名要打的两处）=====

     判据比的是**当前草稿值 vs 已落库值**，不是「有没有被改过」这个标记。所以「改了又改回去」
     必须回到「今天：」——若判据退化成「改过就永远说保存后」，这两条会红。 */

  it('单框改成 D:\\x 再改回原值 → 回到「今天：」（不是永远说「保存后」）', async () => {
    await mount();
    await setValue(singleRoot(), 'D:\\x');
    expect(pathLine()).toBe('保存后：D:\\x\\2026-11-07.md');

    /* 改回已落库的值：`sharedAfterEdit(基准值, 新值)` 判定「改回原值 = 没改」，
       root 于是回到 `mirrorOf` → 与 `storedBase` 相等 */
    await setValue(singleRoot(), 'C:\\Vault');
    expect(pathLine()).toBe('今天：C:\\Vault\\2026-11-07.md');
  });

  it('逐档改成 D:\\x 再手改回去 → 也回到「今天：」', async () => {
    await mount();
    await act(async () => { button('逐个设置').click(); await Promise.resolve(); });
    const timersRoot = () => Array.from(container.querySelectorAll('.sync__card'))
      .find((card) => card.querySelector('.sync__kind')?.textContent === '事项计时')
      ?.querySelector('input') as HTMLInputElement;

    await setValue(timersRoot(), 'D:\\x');
    expect(pathLine()).toBe('保存后：D:\\x\\2026-11-07.md');

    await setValue(timersRoot(), 'C:\\Vault');
    expect(pathLine()).toBe('今天：C:\\Vault\\2026-11-07.md');
  });

  it('`view` 还没加载的那一帧：这一行根本不渲染，不许闪一下「保存后：」', async () => {
    /* 视图永远不回来 = 首帧 + 加载态。`bindings` 此时是 `[]`，块③由 `MdSyncLocalBlock`
       的 `bindings.length === 0` 分支接管，`MdSyncRootRow` 整个不挂载 —— 所以既没有
       `.sync__path`，也不会有任何「保存后：」。 */
    api.get.mockReturnValue(new Promise(() => {}));
    await mount();

    expect(block('data-sync')?.querySelector('.sync__path')).toBeNull();
    expect(container.textContent).not.toContain('保存后');
    expect(container.textContent).not.toContain('今天：');
    expect(block('data-sync')?.textContent).toContain('正在读取落点…');
  });

  it('配置里没有计时那一档时，基准档回退到第一档，这一行照常工作', async () => {
    /* `storedBase` 缺失（`view.config.bindings` 里没有那一档）在正常流程里到不了——
       草稿的 `bindings` 就是从 `view.config.bindings` 回填的。但 `baseOf` 的回退
       （缺 timers 时取 `bindings[0]`）必须成立，否则这一行会白屏或抛错。
       用手改过的两档配置钉住这条。 */
    const base = view();
    api.get.mockResolvedValue({
      ...base,
      config: { ...base.config, bindings: [{ ...BINDINGS[1], root: 'C:\\Vault' }] },
      status: { lastSyncAt: null, lastError: null, bindings: [] },
    });
    await mount();

    /* 只剩便利贴一档 → 它就是基准档；`status.bindings` 里没有它 → 退回前端拼的路径 */
    expect(pathLine()).toBe('今天：C:\\Vault\\2026-11-07.md');
  });
});
