import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataRootInfo } from '../../types/domain/dataRoot';

/* [V0.11.15] 块②（SQLite 落点设置）的口径：
   - 只显示 `current`，不显示出厂值 `defaultPath`（设计 §8-7 点名的坑）；
   - `pending` 是「重启后生效」的提示，不是失败；
   - 失败一律 `rawIpcText` 原文透出，`errorText()` 的润色版一个字都不许出现；
   - `IS_MOBILE` 下整块不渲染，且**不去调** `data_root_get`（手机端它是 desktop_only）。 */

const host = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../lib/platform', () => ({
  get IS_MOBILE() { return host.mobile; },
  HOST_OS: 'desktop',
}));

const rootApi = vi.hoisted(() => ({ get: vi.fn(), change: vi.fn(), open: vi.fn() }));
vi.mock('../../services/api', () => ({
  dataRootApi: rootApi,
  /* 两个文案函数**故意给不同的结果**：断言页面里出现的是原文、不是润色版 */
  rawIpcText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
  errorText: () => '系统调用失败，请重试',
}));

const pickFolder = vi.hoisted(() => vi.fn());
vi.mock('../../services/folderPicker', () => ({ pickFolder }));

import { MdDataRootBlock } from './MdDataRootBlock';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const INFO: DataRootInfo = {
  current: 'D:\\Timing\\data',
  defaultPath: 'C:\\Program Files\\Timing\\data',
  isDefault: false,
  writable: true,
  writableError: null,
  pending: null,
  previous: 'C:\\Tools\\Timing\\data',
  sizeBytes: 65_200_000,
  entries: [
    { name: 'timing.db', isDir: false, present: true, bytes: 18_400_000 },
    { name: 'backups', isDir: true, present: true, bytes: 42_100_000 },
    { name: 'logs', isDir: true, present: true, bytes: 3_200_000 },
    { name: 'md', isDir: true, present: true, bytes: 1_000_000 },
    { name: 'migrated-from-tickbar-app.json', isDir: false, present: false, bytes: 0 },
  ],
  affected: ['事项计时', '便利贴', '待办事项'],
  pluginsInDataRoot: false,
};

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MdDataRootBlock));
    await Promise.resolve();
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

async function click(text: string): Promise<void> {
  await act(async () => {
    button(text).click();
    await Promise.resolve();
  });
}

describe('MdDataRootBlock —— ② SQLite 落点设置', () => {
  beforeEach(() => {
    host.mobile = false;
    rootApi.get.mockReset();
    rootApi.change.mockReset();
    rootApi.open.mockReset();
    pickFolder.mockReset();
    rootApi.get.mockResolvedValue(INFO);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
  });

  it('显示的是当前生效目录，不是出厂默认值（混用会让用户看到错的路径）', async () => {
    await mount();
    expect(container.textContent).toContain('D:\\Timing\\data');
    expect(container.textContent).not.toContain('C:\\Program Files\\Timing\\data');
    expect(container.textContent).toContain('自定义位置');
  });

  it('不可写时徽标带上后端给的原因原文', async () => {
    rootApi.get.mockResolvedValue({ ...INFO, writable: false, writableError: '拒绝访问（os error 5）' });
    await mount();
    expect(container.querySelector('.data__badge[data-ok="false"]')?.textContent)
      .toBe('不可写：拒绝访问（os error 5）');
  });

  it('有待生效的新位置时常驻黄条，点「改回旧位置」调 change(null)（= 撤销，不是没传参）', async () => {
    rootApi.get.mockResolvedValue({ ...INFO, pending: 'E:\\TimingData' });
    rootApi.change.mockResolvedValue({ ...INFO, pending: null });
    await mount();

    const warn = container.querySelector('.data__warn');
    expect(warn?.textContent).toContain('新位置已设置，重启 Timing 之后生效');
    expect(warn?.textContent).toContain('E:\\TimingData');

    await click('改回旧位置');
    expect(rootApi.change).toHaveBeenCalledWith(null);
    expect(container.querySelector('.data__warn')).toBeNull();
  });

  it('「打开文件夹」失败时把后端原文就地显示（不是「系统调用失败」）', async () => {
    rootApi.open.mockRejectedValue(new Error('目录不存在：D:\\Timing\\data'));
    await mount();
    await click('打开文件夹');

    expect(container.querySelector('.sync__error')?.textContent).toBe('目录不存在：D:\\Timing\\data');
    expect(container.textContent).not.toContain('系统调用失败');
  });

  it('「更改位置」列出五项与体积，`present: false` 说「没有这一项」而不是 0 B', async () => {
    await mount();
    await click('更改位置…');
    pickFolder.mockResolvedValue('E:\\TimingData');
    await click('选择目录…');

    expect(pickFolder).toHaveBeenCalled();
    expect(container.textContent).toContain('将把这五项复制到');
    expect(container.textContent).toContain('17.5 MB');
    expect(container.textContent).toContain('没有这一项');
    expect(container.textContent).not.toContain('0 B');
    expect(container.textContent).toContain('旧目录 D:\\Timing\\data 不会删除');
  });

  it('确认后调 change(目标目录)，拿到的新快照带着 pending → 黄条出现', async () => {
    await mount();
    rootApi.change.mockResolvedValue({ ...INFO, pending: 'E:\\TimingData' });
    await click('更改位置…');
    pickFolder.mockResolvedValue('E:\\TimingData');
    await click('选择目录…');
    await click('确认复制并切换');

    expect(rootApi.change).toHaveBeenCalledWith('E:\\TimingData');
    expect(container.querySelector('.data__warn')?.textContent).toContain('E:\\TimingData');
  });

  it('预检拒绝时在对话框里就地显示原文，且不把界面切到「已生效」', async () => {
    await mount();
    rootApi.change.mockRejectedValue(new Error('这个文件夹里已有文件，请选一个空文件夹或新建一个'));
    await click('更改位置…');
    pickFolder.mockResolvedValue('E:\\NotEmpty');
    await click('选择目录…');
    await click('确认复制并切换');

    expect(container.querySelector('.data__confirm .sync__error')?.textContent)
      .toBe('这个文件夹里已有文件，请选一个空文件夹或新建一个');
    expect(container.querySelector('.data__warn')).toBeNull();
  });

  it('手机端整块不渲染，也不去调 data_root_get（桌面独占命令）', async () => {
    host.mobile = true;
    await mount();
    expect(container.innerHTML).toBe('');
    expect(rootApi.get).not.toHaveBeenCalled();
  });

  /* ===== [V0.11.16] C11 按实际受影响的档数说话（QA F3）===== */

  it('C11：三档都受影响时用 PRD 4.0 的原句「这三档」', async () => {
    await mount();
    expect(container.textContent).toContain('这三档落点跟着数据根一起搬。');
  });

  it('C11：只有一档受影响时不许说「这三档」，点名那一档', async () => {
    /* 老用户常见形态：前两档是 Obsidian 绝对路径，只有待办写成 `%APP_DIR%\md` */
    rootApi.get.mockResolvedValue({ ...INFO, affected: ['待办事项'] });
    await mount();

    expect(container.textContent).toContain('待办事项跟着数据根一起搬。');
    expect(container.textContent).not.toContain('这三档');
  });

  it('C11：两档受影响时逐一点名（不进「这三档」那一句）', async () => {
    rootApi.get.mockResolvedValue({ ...INFO, affected: ['便利贴', '待办事项'] });
    await mount();

    expect(container.textContent).toContain('便利贴、待办事项跟着数据根一起搬。');
    expect(container.textContent).not.toContain('这三档');
  });

  it('C11：一档都不受影响时那句整行不出现（不凭空吓人）', async () => {
    rootApi.get.mockResolvedValue({ ...INFO, affected: [] });
    await mount();

    expect(container.textContent).not.toContain('跟着数据根一起搬');
  });
});
