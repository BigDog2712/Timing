/**
 * HostSyncPanel（分析窗「数据与同步」组的宿主同步面）冒烟测试 —— [0.12.1] QA 补测
 * -----------------------------------------------------------------------------
 * 为什么补：T04b 把这 15 个组分从 `src/components/settings/**` 搬到 `src/features/settings/**`
 * 时删掉了 22 个旧测试（约 150 条用例），新位置**一条都没有**。于是最大的一处回归风险
 * 变成「搬过去之后写的还是不是宿主那套命令」——注释会说谎，网关调用不会。
 *
 * 手法：**mock 网关**（`platform/desktop/host*Gateway`），不连真 IPC、不碰 Tauri。
 * 为什么不是 mock `services/hostApi`：那是门面，mock 它等于把「门面 → store → 草稿 →
 * 面板」整条链一起跳过，断言就退化成「点按钮会调到同名函数」。mock 网关之后，
 * `mdSyncSave(config, secret)` 的入参形状是**真的**从面板一路算出来的。
 *
 * 仓库没装 @testing-library（`package.json` 无该依赖），所以按仓内既有写法用
 * `react-dom/client` + `act`，不引入新依赖（见 `components/pill/HandleCluster.test.tsx`）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 网关的全部出口一次性伪造：`vi.hoisted` 保证它在 `vi.mock` 工厂之前就绪（避开 TDZ） */
const g = vi.hoisted(() => ({
  mdSyncGet: vi.fn(),
  mdSyncSave: vi.fn(),
  mdSyncRun: vi.fn(),
  mdSyncOpen: vi.fn(),
  mdSyncTest: vi.fn(),
  mdSyncDecisions: vi.fn(),
  mdSyncResolve: vi.fn(),
  mdBackupList: vi.fn(),
  mdBackupOpen: vi.fn(),
  mdBackupRestore: vi.fn(),
  mdBackupExport: vi.fn(),
  dataRootGet: vi.fn(),
  dataRootChange: vi.fn(),
  dataRootOpen: vi.fn(),
  getMigrationInfo: vi.fn(),
  openLegacyDir: vi.fn(),
  dailyStatusGet: vi.fn(),
  dailyStatusSet: vi.fn(),
  mdSafPick: vi.fn(),
  mdSafStatus: vi.fn(),
}));

vi.mock('../../../../platform/desktop/hostSyncGateway', () => ({ ...g }));
/* 事件订阅走 `@tauri-apps/api/event`；这里连订阅面一起挡掉，测试不碰 Tauri 注入对象。
   路径必须是 `services/host/hostEvents`（不是 `services/hostEvents`）：写错不会报错，
   mock 只会挂在一个没人 import 的模块上，真 hook 照跑并往 stderr 喷一片 subscribe 失败。 */
vi.mock('../../services/host/hostEvents', () => ({
  MD_SYNC_CHANGED_EVENT: 'md-sync:changed',
  MD_SYNC_DECISION_REQUIRED_EVENT: 'md-sync:decision-required',
  useHostEvent: () => undefined,
}));

import { HostSyncPanel } from './HostSyncPanel';
import { AUTO_COPY } from '../../services/host/mdSyncCopy';
import { useMdSyncStore } from '../../services/host/mdSyncRuntimeStore';

/* 夹具（`BINDING` / `view()` / `DATA_ROOT`）搬到 `hostSyncPanelFixture.ts`：
   本文件撞 300 行，夹具与用例比例失衡；新加一条同步卡用例时也不必再抄一份视图。 */
import { DATA_ROOT, view } from './hostSyncPanelFixture';

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

/** 渲染 + 冲两轮微任务：`load()` 与备份列表都是 promise，一轮 flush 不够 */
async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(HostSyncPanel));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

function flush(): Promise<void> {
  return act(async () => { await Promise.resolve(); });
}

function text(): string {
  return container.textContent ?? '';
}

function blockTitles(): string[] {
  return Array.from(container.querySelectorAll('.data__block-title'), (el) => el.textContent ?? '');
}

function toggleOf(title: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`[aria-label="展开${title}"]`)
    ?? container.querySelector<HTMLButtonElement>(`[aria-label="收起${title}"]`);
  if (!el) throw new Error(`找不到「${title}」的折叠按钮`);
  return el;
}

function buttonByText(label: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`找不到「${label}」按钮`);
  return el;
}

/** 受控 input：React 19 只认原生 setter + `input` 事件，直接改 `.value` 不会触发 onChange */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('拿不到原生 value setter');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  useMdSyncStore.setState({ view: null, loaded: false, loading: false, saving: false, error: null });
  g.mdSyncGet.mockResolvedValue(view());
  g.mdSyncSave.mockResolvedValue(view());
  g.mdSyncDecisions.mockResolvedValue([]);
  g.mdBackupList.mockResolvedValue([]);
  g.dataRootGet.mockResolvedValue(DATA_ROOT);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
});

describe('挂载与六块骨架', () => {
  it('s01_mounts_and_renders_the_six_blocks_in_fixed_order', async () => {
    await mount();
    /* 六块顺序固定（PRD §4.2 / O7）：顺序错了就是「用户按记忆点错块」 */
    expect(blockTitles()).toEqual([
      'Markdown 落点设置',
      'SQLite 落点设置',
      'Markdown 同步',
      'WebDAV 本地同步',
      'WebDAV 云端同步',
      '计时数据备份与恢复',
    ]);
    expect(g.mdSyncGet).toHaveBeenCalledTimes(1);
    expect(g.mdBackupList).toHaveBeenCalledTimes(1);
    /* [本轮] 卡片外壳与标题统一到同页其它卡：根节点是 `at-panel`，标题走
       `SettingsPanelHeader` 的 `h2`，且用分组锚点表里的名字「同步与备份」——
       原来写的是宿主页签名「数据管理」（导航点的是前者，卡上写后者就得靠位置才对得上）。 */
    expect(container.firstElementChild?.className).toContain('at-panel');
    expect(container.querySelector('h2')?.textContent).toBe('同步与备份');
    expect(text()).not.toContain('数据管理');
  });

  it('s02_reads_back_the_saved_config_into_the_controls', async () => {
    await mount();
    const switchOf = (label: string) => container.querySelector(`[role="switch"][aria-label="${label}"]`);
    /* 全页恰好 3 个开关，各管各的（O8）；已启用 → aria-checked=true 而不是默认值 */
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(3);
    expect(switchOf('启用 Markdown 同步')?.getAttribute('aria-checked')).toBe('true');
    expect(switchOf('启用本地同步')?.getAttribute('aria-checked')).toBe('false');
    /* 「立即同步」在草稿干净且未加载完时可用；「放弃修改」只在 dirty 时可用 */
    expect(buttonByText('放弃修改').disabled).toBe(true);
  });
});

describe('写路径：改一个字段 → md_sync_save 的入参形状', () => {
  it('s03_editing_the_shared_root_fans_out_to_all_three_bindings', async () => {
    await mount();
    act(() => toggleOf('Markdown 同步').click());

    const input = container.querySelector<HTMLInputElement>('input[aria-label="日记落点根目录"]');
    if (!input) throw new Error('展开块③之后没有落点输入框');
    act(() => typeInto(input, 'D:\\vault'));

    /* 草稿脏了才允许点保存；按钮文案就是「保存并同步」 */
    const save = buttonByText('保存并同步');
    expect(save.disabled).toBe(false);
    act(() => save.click());
    await flush();

    expect(g.mdSyncSave).toHaveBeenCalledTimes(1);
    const [config, secret] = g.mdSyncSave.mock.calls[0] as [Record<string, unknown>, unknown];
    /* 单框意图只在保存时扇出：三档 root 全部变成用户亲手打的这个目录 */
    expect((config.bindings as { root: string }[]).map((b) => b.root))
      .toEqual(['D:\\vault', 'D:\\vault', 'D:\\vault']);
    /* 载荷只带这几个键；`cloud` 恒 null（legacy 键不出现），两条新通路按「从未配置」归一成 null */
    expect(Object.keys(config).sort()).toEqual(
      ['bindings', 'cloud', 'cloudFolder', 'cloudWebdav', 'diaryTemplate', 'enabled', 'pollSecs'],
    );
    expect(config.enabled).toBe(true);
    expect(config.pollSecs).toBe(180); /* 后端原值透传，不许前端从界面推算 */
    expect(config.cloudFolder).toBeNull();
    expect(config.cloudWebdav).toBeNull();
    expect(config.diaryTemplate).toBe('');
    /* 没碰过密码框 → undefined（不动已存密文）；写成 '' 就是「清空密码」 */
    expect(secret).toBeUndefined();
    expect(text()).toContain('已保存并同步');
  });

  it('s04_toggling_the_master_switch_is_a_draft_change_not_an_immediate_save', async () => {
    await mount();
    const master = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="启用 Markdown 同步"]');
    if (!master) throw new Error('找不到总开关');
    act(() => master.click());
    expect(master.getAttribute('aria-checked')).toBe('false');
    /* PRD A6：保存入口只有一个（底部条）。开关只动草稿，不许顺手发 IPC */
    expect(g.mdSyncSave).not.toHaveBeenCalled();
    expect(buttonByText('放弃修改').disabled).toBe(false);

    act(() => buttonByText('保存并同步').click());
    await flush();
    expect(g.mdSyncSave).toHaveBeenCalledTimes(1);
    expect((g.mdSyncSave.mock.calls[0][0] as { enabled: boolean }).enabled).toBe(false);
  });
});

describe('失败面：出错误文案，不静默', () => {
  it('s05_save_failure_shows_the_host_message_on_the_panel', async () => {
    g.mdSyncSave.mockRejectedValueOnce(new Error('落点写入失败：磁盘只读'));
    await mount();
    act(() => buttonByText('保存并同步').click());
    await flush();

    /* 定位不到具体落点的失败留在页签顶部（能定位的交给块①/③），但一个字都不许吞 */
    expect(text()).toContain('落点写入失败：磁盘只读');
    expect(buttonByText('保存并同步').disabled).toBe(false); /* saving 复位，可重试 */
  });
});

/**
 * [0.13.x] 自动同步三档：标签逐字 + 每档只出现自己那句说明。
 * 三档改成完整动作名「手动同步 / 定时同步 / 智能同步」，本地目录与云端两条通路
 * 共用同一份组件与文案；智能档见 `smartNote`、手动档见 `offNote`、只有定时档出现
 * 分钟框（min/max 仍是 5/120，夹值在 `clampAutoMinutes`）——前两档挂个灰框会被
 * 读成「选了却没生效」。
 */
describe('[0.13.x] 自动同步三档的文案与控件可见性', () => {
  it('t01_each_tier_shows_only_its_own_note_and_minutes_field_is_interval_only', async () => {
    const webdavView = view();
    webdavView.config.cloudWebdav = {
      enabled: true,
      baseUrl: 'https://dav.example/dav/',
      user: 'someone',
      auto: { schedule: 'smart', intervalMinutes: 15 },
    };
    g.mdSyncGet.mockResolvedValue(webdavView);
    await mount();
    act(() => toggleOf('WebDAV 云端同步').click());
    await flush();
    /* 块④（本地）也可挂一份；挑**可用**的那一份，禁用态点了没反应 */
    const auto = Array.from(container.querySelectorAll<HTMLElement>('.sync-cloud__auto'))
      .find((el) => el.getAttribute('data-disabled') === 'false');
    if (!auto) throw new Error('找不到可用的「自动同步」三档控件');
    const labels = Array.from(auto.querySelectorAll('.sync-cloud__auto-item'), (el) => el.textContent?.trim());
    expect(labels).toEqual([AUTO_COPY.off, AUTO_COPY.interval, AUTO_COPY.smart]);
    expect(labels).toEqual(['手动同步', '定时同步', '智能同步']);
    /* 默认档是智能：只有那句行为说明，没有分钟框 */
    expect(auto.textContent).toContain(AUTO_COPY.smartNote);
    expect(auto.querySelector('input[type="number"]')).toBeNull();
    /* 手动档：一句「只在点立即同步时同步」，仍然没有分钟框 */
    act(() => (auto.querySelector('[data-tier="off"]') as HTMLButtonElement).click());
    await flush();
    expect(auto.textContent).toContain(AUTO_COPY.offNote);
    expect(auto.querySelector('input[type="number"]')).toBeNull();
    /* 定时档：分钟框出现，边界仍是 5 ~ 120 */
    act(() => (auto.querySelector('[data-tier="interval"]') as HTMLButtonElement).click());
    await flush();
    const minutes = auto.querySelector<HTMLInputElement>('input[type="number"]');
    expect(minutes?.min).toBe('5');
    expect(minutes?.max).toBe('120');
    expect(auto.textContent).toContain(AUTO_COPY.times);
    expect(auto.textContent).toContain(AUTO_COPY.range);
  });
});
