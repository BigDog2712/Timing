import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from '../../types/domain';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import {
  NO_SHARED,
  applyShared,
  differingBindings,
  disabledKinds,
  isMixed,
  mirrorOf,
  sharedAfterEdit,
  sharedValue,
} from './mdSyncShared';
import type { MdSyncDraft } from './useMdSyncDraft';

/* [V0.11.16] 「一个框写三档」的全部判据（设计 §3.2 的三条边界）。
   这条 bug 一旦溜进去就违反 PRD N2（老用户三档被一次「什么都没改的保存」统一掉，
   且不可逆），所以必须有机器证据，不能只靠手点。

   前四条是纯函数（不挂载）；后三条挂真 Hook——「逐档手改作废统一意图」只存在于
   `useMdSyncDraft` 里，纯函数测不到它。 */

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault2', file: '{date}-notes.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: false, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), run: vi.fn(), open: vi.fn(), test: vi.fn() }));
vi.mock('../../services/api', () => ({
  mdSyncApi: api,
  errorText: (err: unknown) => (err instanceof Error ? err.message : '操作失败'),
}));

import { useMdSyncDraft } from './useMdSyncDraft';

function view(): MdSyncViewCloud {
  return {
    today: '2026-11-07',
    config: { enabled: true, pollSecs: 900, bindings: BINDINGS, cloud: null },
    cloud: {
      enabled: false, mode: 'localfolder', hasSecret: false,
      todayPushed: false, pendingDates: [], lastError: null,
    },
    status: { lastSyncAt: null, lastError: null, bindings: [] },
  };
}

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let draft: MdSyncDraft | null = null;

/** 只挂 Hook，把结果抬到一个变量里：本文件测的是草稿层，不测版面 */
function Harness() {
  draft = useMdSyncDraft();
  return null;
}

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

const current = (): MdSyncDraft => {
  if (!draft) throw new Error('草稿还没挂上');
  return draft;
};

describe('mdSyncShared —— 单框 ↔ 三档的纯函数', () => {
  it('三档 file 各异时，`shared = NO_SHARED` 的 applyShared 逐字段恒等（一次都没改就不许动）', () => {
    const out = applyShared(BINDINGS, NO_SHARED);
    expect(out.map((binding) => binding.file)).toEqual(['{date}.md', '{date}-notes.md', '{date}.md']);
    expect(out.map((binding) => binding.root)).toEqual(BINDINGS.map((binding) => binding.root));
    /* 引用可以变，值不许变——这是 PRD B4「不改直接保存，三档 file 各留原值」的纯函数版 */
    expect(() => {
      out[0].root = '改坏了';
    }).not.toThrow();
    expect(BINDINGS[0].root).toBe('C:\\Vault');
  });

  it('字符串意图覆盖三档，null 字段保留各档原值', () => {
    const out = applyShared(BINDINGS, { file: '{date}-asd.md', root: null });
    expect(out.map((binding) => binding.file)).toEqual(['{date}-asd.md', '{date}-asd.md', '{date}-asd.md']);
    expect(out.map((binding) => binding.root)).toEqual(BINDINGS.map((binding) => binding.root));
  });

  it('改回原值即视为没改（打完再删回原样也算）', () => {
    expect(sharedAfterEdit('{date}.md', '{date}.md')).toBeNull();
    expect(sharedAfterEdit('{date}.md', '')).toBe('');
    expect(sharedAfterEdit('{date}.md', '{date}-asd.md')).toBe('{date}-asd.md');
  });

  it('基准值取计时那一档；mixed 只看「不全相同」；关档与差异项各归各的口径', () => {
    expect(mirrorOf(BINDINGS, 'root')).toBe('C:\\Vault');
    expect(isMixed(BINDINGS, 'root')).toBe(true);
    expect(isMixed(BINDINGS, 'file')).toBe(true);
    /* 三档同值（新装用户的出厂态）不提示、不出「逐个设置」 */
    expect(isMixed([BINDINGS[0], { ...BINDINGS[0], kind: 'notes' }], 'root')).toBe(false);
    expect(isMixed([] as MdSyncBinding[], 'root')).toBe(false);
    /* 单框有意图时显示意图，没有时显示计时档 */
    expect(sharedValue(BINDINGS, NO_SHARED, 'root')).toBe('C:\\Vault');
    expect(sharedValue(BINDINGS, { file: null, root: 'D:\\md' }, 'root')).toBe('D:\\md');

    expect(disabledKinds(BINDINGS)).toEqual(['todos']);
    /* 只列与计时档不同的那两项（待办事项也要列：它与计时档不一样） */
    expect(differingBindings(BINDINGS, 'root').map((item) => item.label)).toEqual(['便利贴', '待办事项']);
    /* 计时档自己不列 */
    expect(differingBindings(BINDINGS, 'root').some((item) => item.kind === 'timers')).toBe(false);
    expect(differingBindings(BINDINGS, 'file').map((item) => item.label)).toEqual(['便利贴']);
  });
});

describe('useMdSyncDraft —— 统一意图的读写与作废', () => {
  beforeEach(() => {
    for (const fn of [api.get, api.save, api.run]) fn.mockReset();
    api.get.mockResolvedValue(view());
    api.save.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...view(), config }));
    useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
    draft = null;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
  });

  it('改单框 → 意图生效，保存时三档统一；不改单框 → 三档原值落库', async () => {
    await mount();
    expect(current().resolvedBindings.map((binding) => binding.root)).toEqual(BINDINGS.map((b) => b.root));

    await act(async () => { current().setSharedRoot('D:\\md'); await Promise.resolve(); });
    expect(current().shared.root).toBe('D:\\md');
    expect(current().resolvedBindings.map((binding) => binding.root)).toEqual(['D:\\md', 'D:\\md', 'D:\\md']);
    /* `bindings` 本身没被改写：逐档面板读的是「此刻真正存着的东西」（设计 §3.4） */
    expect(current().bindings.map((binding) => binding.root)).toEqual(BINDINGS.map((b) => b.root));
    expect(current().dirtyParts.sync).toBe(true);
    expect(current().dirtyParts.format).toBe(false);
  });

  it('逐档手改 → 作废该字段的意图（否则保存时的扇出会把刚改的那一档盖回去）', async () => {
    await mount();
    await act(async () => { current().setSharedRoot('D:\\md'); await Promise.resolve(); });
    await act(async () => {
      current().updateBinding(1, { ...BINDINGS[1], root: 'C:\\Manual' }, 'sync');
      await Promise.resolve();
    });

    expect(current().shared.root).toBeNull();
    /* 意图作废后不再扇出：计时档与待办档回到各自原值，只有被手改的那一档变 */
    expect(current().resolvedBindings.map((binding) => binding.root))
      .toEqual(['C:\\Vault', 'C:\\Manual', '%APP_DIR%\\md']);
  });

  it('只改 root 不会顺手丢掉 file 的意图；「放弃修改」把两处意图一起清掉', async () => {
    await mount();
    await act(async () => {
      current().setSharedFile('{date}-asd.md');
      current().setSharedRoot('D:\\md');
      await Promise.resolve();
    });
    expect(current().shared).toEqual({ file: '{date}-asd.md', root: 'D:\\md' });

    await act(async () => {
      current().updateBinding(1, { ...BINDINGS[1], root: 'C:\\Manual' }, 'sync');
      await Promise.resolve();
    });
    expect(current().shared).toEqual({ file: '{date}-asd.md', root: null });

    await act(async () => { current().discard(); await Promise.resolve(); });
    expect(current().shared).toEqual(NO_SHARED);
    expect(current().resolvedBindings.map((binding) => binding.file))
      .toEqual(['{date}.md', '{date}-notes.md', '{date}.md']);
  });

  it('保存后意图复位：落库的三档已是统一值，单框不会跳一下', async () => {
    await mount();
    await act(async () => { current().setSharedFile('{date}-asd.md'); await Promise.resolve(); });
    await act(async () => { await current().save(); });

    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        bindings: [
          { ...BINDINGS[0], file: '{date}-asd.md' },
          { ...BINDINGS[1], file: '{date}-asd.md' },
          { ...BINDINGS[2], file: '{date}-asd.md' },
        ],
      }),
      undefined,
    );
    expect(current().shared).toEqual(NO_SHARED);
    expect(current().dirty).toBe(false);
  });
});
