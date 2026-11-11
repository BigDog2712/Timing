/**
 * useBackupList 的判据（[0.12.1] T04b 新增：搬过来的这份原来零覆盖）
 * -----------------------------------------------------------------------------
 * 「备份列表只有一个数据源」是 PRD R11 / 设计 §3.1 的结论：块⑤ 的折叠标题行与展开后的
 * 第一条必须**同源同值**。所以这个 Hook 只要错在「拉两次」「失败吞掉」「最新一条取错」，
 * 症状都是用户看到两个说的不是一回事的备份时间——肉眼看不出是 bug，只会觉得「这软件不靠谱」。
 *
 * 三条：成功（含 latest 的取法）/ 空列表 / 失败出人话。失败那条尤其重要：IPC 挂了却
 * `error` 为空，界面上就是一块永不加载的「读取中」。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdBackupItem } from './hostTypes';
import { useBackupList, type MdBackupList } from './useBackupList';

const h = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../hostApi', () => ({
  mdBackupApi: { list: h.list },
  /* 与真实实现同口径：宿主 `AppError.message` 已是中文，取不到才兜底 */
  errorText: (err: unknown) =>
    (err instanceof Error && err.message.trim().length > 0 ? err.message : '操作失败，请重试'),
}));

function item(name: string, atMs: number): MdBackupItem {
  return { name, target: 'folder', source: 'auto', date: null, atMs, bytes: 1024 };
}

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let value: MdBackupList | null = null;

function Harness() {
  value = useBackupList();
  return null;
}

const current = (): MdBackupList => {
  if (!value) throw new Error('Hook 还没挂上');
  return value;
};

beforeEach(async () => {
  h.list.mockReset();
  value = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

/** 挂载并等首帧那次 `refresh()` 落定。 */
async function mount(): Promise<void> {
  await act(async () => { root.render(createElement(Harness)); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

describe('useBackupList —— 备份列表的单一数据源', () => {
  it('成功：列表原样落地，latest 取全局 atMs 最大者（不是第一条）', async () => {
    /* 后端按组内倒序返回，但**跨组**不一定有序：这里故意把最新的放在中间。 */
    h.list.mockResolvedValue([item('md-2026-11-09.zip', 200), item('md-2026-11-10.zip', 300), item('x.zip', 100)]);

    await mount();

    expect(h.list).toHaveBeenCalledTimes(1); /* 一次挂载只许拉一次（两条命令就是两件事实） */
    expect(current().items.map((entry) => entry.name))
      .toEqual(['md-2026-11-09.zip', 'md-2026-11-10.zip', 'x.zip']);
    expect(current().latest?.name).toBe('md-2026-11-10.zip');
    expect(current().loading).toBe(false);
    expect(current().error).toBeNull();
  });

  it('空列表：items 为空、latest 为 null（不是 undefined，也不是「读取中」卡住）', async () => {
    h.list.mockResolvedValue([]);

    await mount();

    expect(current().items).toEqual([]);
    expect(current().latest).toBeNull();
    expect(current().loading).toBe(false);
    expect(current().error).toBeNull();
  });

  it('失败：把宿主的原话放进 error，loading 落回 false，旧列表保留', async () => {
    h.list.mockRejectedValueOnce(new Error('备份目录不可读'));
    await mount();

    expect(current().error).toBe('备份目录不可读');
    expect(current().loading).toBe(false);
    expect(current().items).toEqual([]);

    /* 再点一次刷新：成功后错误必须被清掉（否则红字永远挂在那儿） */
    h.list.mockResolvedValueOnce([item('md-2026-11-11.zip', 400)]);
    await act(async () => { await current().refresh(); });

    expect(current().error).toBeNull();
    expect(current().latest?.name).toBe('md-2026-11-11.zip');
  });
});
