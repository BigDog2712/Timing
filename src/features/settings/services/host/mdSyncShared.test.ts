/**
 * mdSyncShared + useMdSyncDraft 的判据（[0.12.1] T04b：从
 * `src/components/settings/mdSyncShared.test.ts` 搬来）
 * -----------------------------------------------------------------------------
 * 「一个框写三档」的全部判据（设计 §3.2 的三条边界）。这条 bug 一旦溜进去就违反 PRD N2
 * （老用户三档被一次「什么都没改的保存」统一掉，且不可逆），所以必须有机器证据。
 *
 * 前四条是纯函数（不挂载）；后五条挂真 Hook ——「逐档手改把统一意图固化到其余档」只存在于
 * `useMdSyncDraft` 里，纯函数测不到它。
 *
 * **只改了两处 import 口径**（其余逐字搬运）：
 *   · 类型来自 `./hostTypes`（分析窗侧的镜像），不是 `types/domain`；
 *   · 断言的目标从 `services/api.mdSyncApi` 换成**网关**：搬过来的
 *     `mdSyncRuntimeStore` 直接调 `hostSyncGateway`（门面 `hostApi` 只是给组件用的），
 *     所以 `mdSyncSave` 才是一次保存的真正出口。mock 网关时用 `importOriginal` 展开其余
 *     命令名，否则 ESM 会因为缺 export 在 import 期就报错（不是断言失败，是模块炸）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdSyncBinding, MdSyncViewCloud } from './hostTypes';
import { useMdSyncStore } from './mdSyncRuntimeStore';
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

const gw = vi.hoisted(() => ({
  mdSyncGet: vi.fn(),
  mdSyncSave: vi.fn(),
  mdSyncRun: vi.fn(),
}));

vi.mock('../../../../platform/desktop/hostSyncGateway', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...gw };
});
/* 事件订阅在 jsdom 里没有 Tauri 注入对象；本文件测的是草稿层，不测事件。 */
vi.mock('./hostEvents', () => ({
  useHostEvent: () => undefined,
  MD_SYNC_CHANGED_EVENT: 'md-sync:changed',
}));

import type { MdSyncDraft } from './useMdSyncDraft';
import { useMdSyncDraft } from './useMdSyncDraft';

const BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: 'C:\\Vault', file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: 'C:\\Vault2', file: '{date}-notes.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: false, root: '%APP_DIR%\\md', file: '{date}.md', heading: '#### 待办事项' },
];

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
    for (const fn of [gw.mdSyncGet, gw.mdSyncSave, gw.mdSyncRun]) fn.mockReset();
    gw.mdSyncGet.mockResolvedValue(view());
    gw.mdSyncSave.mockImplementation(async (config: MdSyncViewCloud['config']) => ({ ...view(), config }));
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

  it('逐档手改 → 意图先固化到其余档，再让本档写新值（[QA F2] 修掉了「填的值凭空消失」）', async () => {
    await mount();
    await act(async () => { current().setSharedRoot('D:\\md'); await Promise.resolve(); });
    await act(async () => {
      current().updateBinding(1, { ...BINDINGS[1], root: 'C:\\Manual' }, 'sync');
      await Promise.resolve();
    });

    expect(current().shared.root).toBeNull();
    /* 三档真实落库值：单框填的 D:\md 落到其余两档，被手改那档保留手改值。 */
    expect(current().bindings.map((binding) => binding.root))
      .toEqual(['D:\\md', 'C:\\Manual', 'D:\\md']);
    /* 意图已固化 → `resolvedBindings` 与 `bindings` 同值（保存不会再多改一遍） */
    expect(current().resolvedBindings.map((binding) => binding.root))
      .toEqual(['D:\\md', 'C:\\Manual', 'D:\\md']);
  });

  it('没有意图时逐档手改不扇出（N2：一次什么都没改的保存不许统一三档）', async () => {
    await mount();
    await act(async () => {
      current().updateBinding(1, { ...BINDINGS[1], root: 'C:\\Manual' }, 'sync');
      await Promise.resolve();
    });

    expect(current().shared.root).toBeNull();
    expect(current().bindings.map((binding) => binding.root))
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

    expect(gw.mdSyncSave).toHaveBeenCalledWith(
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
