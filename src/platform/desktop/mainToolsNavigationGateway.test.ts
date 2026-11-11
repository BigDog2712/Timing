/**
 * `takeMainToolsTarget` 的载荷形状单测（P0-03 / P1-02 · 跨语言契约）
 * -----------------------------------------------------------------------------
 * 本网关解析的 JSON 由 Rust `cmd_take_main_tools_target`（`commands/insight/window_cmd.rs`
 * 的 `MainWindowTargetDto`）生成，两侧必须逐字对齐；错位的症状是「点了『今天』，窗开了但
 * 停在默认页」——没有报错、没有日志。这里照抄 Rust 单测钉住的载荷，任一侧改动必须一起红。
 * （`{overview:true}` 那一支在姊妹文件 `mainToolsNavigationGateway.overview.test.ts`。）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';

const { invokeMock, doorbell } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  doorbell: { ring: null as null | (() => void) },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
/* `listen` 把回调存进 `doorbell`：`main-tools-target-changed` 只是门铃、不带载荷，
   用例手动摇铃走「热」路径；「挂载即 take」走「冷」路径。 */
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: () => void) => {
    doorbell.ring = handler;
    return () => { doorbell.ring = null; };
  }),
}));

import { takeMainToolsTarget } from './mainToolsNavigationGateway.ts';
import {
  useMainToolsNavigation,
  type HistoryDateRequest,
  type MainToolsNavigationDeps,
} from '../../app/hooks/useMainToolsNavigation.ts';

/** 让下一次 `take` 拿到这份载荷（模拟 Rust 命令的返回值）。 */
function respondWith(payload: unknown): void {
  invokeMock.mockResolvedValueOnce(payload);
}

describe('takeMainToolsTarget —— 落点载荷形状', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('p003_invokes_the_take_command_with_no_arguments', async () => {
    respondWith(null);
    await takeMainToolsTarget();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('cmd_take_main_tools_target');
  });

  it('p003_null_and_undefined_mean_no_pending_target', async () => {
    /* Rust 返回 `Option<MainWindowTargetDto>`：`None` → JSON null。 */
    respondWith(null);
    await expect(takeMainToolsTarget()).resolves.toBeNull();

    respondWith(undefined);
    await expect(takeMainToolsTarget()).resolves.toBeNull();
  });

  it('p003_tools_branch_matches_the_rust_serialization', async () => {
    respondWith({ tools: 'pomodoro' });
    await expect(takeMainToolsTarget()).resolves.toEqual({ kind: 'tools', section: 'pomodoro' });

    respondWith({ tools: 'reminders' });
    await expect(takeMainToolsTarget()).resolves.toEqual({ kind: 'tools', section: 'reminders' });
  });

  it('p003_history_branch_matches_the_rust_serialization', async () => {
    respondWith({ history: { dateKey: '2026-11-10', focusApp: 'Code.exe' } });
    await expect(takeMainToolsTarget()).resolves.toEqual({
      kind: 'history', dateKey: '2026-11-10', focusApp: 'Code.exe',
    });

    respondWith({ history: { dateKey: '2026-11-10', focusApp: null } });
    await expect(takeMainToolsTarget()).resolves.toEqual({
      kind: 'history', dateKey: '2026-11-10', focusApp: null,
    });
  });

  it('p003_missing_focus_app_degrades_to_null_instead_of_failing', async () => {
    /* Rust 恒发 `focusApp`（哪怕是 null），但字段缺失时也必须退化成 null，而不是把整个
       落点判成非法——应用聚焦提示丢了可以接受，日期丢了不行。 */
    respondWith({ history: { dateKey: '2026-11-10' } });
    await expect(takeMainToolsTarget()).resolves.toEqual({
      kind: 'history', dateKey: '2026-11-10', focusApp: null,
    });

    respondWith({ history: { dateKey: '2026-11-10', focusApp: '' } });
    await expect(takeMainToolsTarget()).resolves.toEqual({
      kind: 'history', dateKey: '2026-11-10', focusApp: null,
    });
  });

  it('p003_tools_wins_when_both_keys_are_present', async () => {
    /* Rust 侧各键互斥（`skip_serializing_if`），这里只钉「先看 tools」的判序。 */
    respondWith({ tools: 'pomodoro', history: { dateKey: '2026-11-10', focusApp: null } });
    await expect(takeMainToolsTarget()).resolves.toEqual({ kind: 'tools', section: 'pomodoro' });
  });

  it('t03_settings_branch_matches_the_rust_serialization', async () => {
    /* 托盘「设置…」与药丸手柄 `settings.open` 都落到这里（[0.12.1] 设置不再是独立窗）。
       Rust 只在 `settings: Some(true)` 时发这个键，`false` / 字符串 / 数字一律判非法——放行
       `false` 等于给「设置被取消」造一个并不存在的语义（与 overview 那支同一口径）。 */
    respondWith({ settings: true });
    await expect(takeMainToolsTarget()).resolves.toEqual({ kind: 'settings' });

    for (const payload of [{ settings: false }, { settings: 'true' }, { settings: 1 }]) {
      respondWith(payload);
      await expect(takeMainToolsTarget(), `${JSON.stringify(payload)} 应抛错`).rejects.toThrow(
        'Invalid main window target',
      );
    }
  });

  it('t03_settings_yields_to_history_and_wins_over_overview', async () => {
    /* 判序 `tools > history > settings > overview`，与 Rust `PatinaOpenTarget::into_view()`
       逐条同序（Rust 侧那条判序由 `commands/window_cmd.rs` 的 into_view 单测钉住）。两键并存
       本是防御性分支：真走到这一步说明 Rust 的互斥被改坏了，行为也必须确定。 */
    respondWith({ history: { dateKey: '2026-11-10', focusApp: null }, settings: true });
    await expect(takeMainToolsTarget()).resolves.toEqual({
      kind: 'history', dateKey: '2026-11-10', focusApp: null,
    });

    respondWith({ settings: true, overview: true });
    await expect(takeMainToolsTarget()).resolves.toEqual({ kind: 'settings' });
  });

  it('p003_illegal_payloads_throw_instead_of_returning_null', async () => {
    /* 空对象 / 空日期 / 未知分区 / 旧版裸字符串：一律抛错。静默返回 null 会退化成
       「只把窗叫到前台」，用户永远不知道自己点丢了。 */
    for (const payload of [
      {},
      { history: {} },
      { history: { dateKey: '' } },
      { tools: 'unknown-section' },
      { tools: null },
      { history: null },
      'pomodoro',
      42,
    ]) {
      respondWith(payload);
      await expect(takeMainToolsTarget(), `载荷 ${JSON.stringify(payload)} 应抛错`).rejects.toThrow(
        'Invalid main window target',
      );
    }
  });

  it('p003_blank_date_key_is_filtered_by_the_consumer_not_the_gateway', async () => {
    /* 两层防线各管一段：Rust `into_history_target` 先 `trim()`（空日期在源头退化成「只
       show」，见 commands/window_cmd.rs 的单测）；本网关只要求非空字符串；真正的日期合法
       性由 `isSelectableDateKey` 兜底。这里断言「网关放行、不改写」，把第二层钉成契约。 */
    respondWith({ history: { dateKey: '   ', focusApp: null } });
    await expect(takeMainToolsTarget()).resolves.toEqual({
      kind: 'history', dateKey: '   ', focusApp: null,
    });
  });
});

/* 链路后半段：落点 → `HistoryDateRequest` → 高亮键（P0-03 ③ · P1-02 ④） */
/* B2 变异实验：把 `focusApp: target.focusApp ?? null` 改成 `focusApp: null`，全仓 752 条
 * 用例**全绿**——"点了「今天」那个应用真的会亮"没有任何判据。所以这里刻意**不 mock 网关**
 * （只 mock tauri 的 `invoke` / `listen`），真实走「载荷 → 网关解析 → hook → 视图/请求」。 */

/** 读源码去注释：注释里正当地写着 `focusApp`，拿注释当证据会让用例变成"删注释就红"。 */
function readSource(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const HISTORY_SRC = readSource('../../features/history/components/History.tsx');
const APP_SHELL_SRC = readSource('../../app/AppShell.tsx');

describe('focusApp 从落点到日期请求（P0-03 ③）', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    invokeMock.mockReset();
    doorbell.ring = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** 放完 effect 里那串「订阅 → take → navigate → set」的微任务。 */
  async function flush(times = 6): Promise<void> {
    await act(async () => {
      for (let i = 0; i < times; i += 1) await Promise.resolve();
    });
  }

  /** 最小宿主：只挂 hook。`setHistoryDateRequest` 用**真状态**模拟 dispatch（含函数式更新），
      `requestId` 自增才验得出来。 */
  function mount(options: { navigated?: boolean } = {}) {
    const state = { request: null as HistoryDateRequest | null };
    const navigate = vi.fn(async () => ({ navigated: options.navigated ?? true }));
    const setHistoryDateRequest = vi.fn((update: unknown) => {
      state.request = (typeof update === 'function'
        ? (update as (current: HistoryDateRequest | null) => HistoryDateRequest | null)(state.request)
        : update) as HistoryDateRequest | null;
    });
    const setToolsInitialTarget = vi.fn();
    const deps = {
      navigate,
      setToolsInitialTarget,
      setHistoryDateRequest,
    } as unknown as MainToolsNavigationDeps;

    act(() => {
      root.render(createElement(function Host() {
        useMainToolsNavigation(deps);
        return null;
      }));
    });
    return { state, navigate };
  }

  it('p003_focus_app_reaches_the_date_request_verbatim', async () => {
    respondWith({ history: { dateKey: '2026-11-10', focusApp: 'Code.exe' } });
    const { state } = mount();
    await flush();

    expect(state.request).toEqual({ dateKey: '2026-11-10', requestId: 1, focusApp: 'Code.exe' });
  });

  it('p003_doorbell_target_carries_focus_app_and_bumps_request_id', async () => {
    /* 冷启动（挂载即 take）与热路径（门铃）必须同样透传；连点两次「今天」还要靠
       requestId 区分，否则 `History` 认不出"又一次跳到同一天"。 */
    respondWith({ history: { dateKey: '2026-11-10', focusApp: null } });
    const { state } = mount();
    await flush();
    expect(state.request).toEqual({ dateKey: '2026-11-10', requestId: 1, focusApp: null });

    respondWith({ history: { dateKey: '2026-11-10', focusApp: 'WeChat.exe' } });
    act(() => doorbell.ring?.());
    await flush();
    expect(state.request).toEqual({ dateKey: '2026-11-10', requestId: 2, focusApp: 'WeChat.exe' });
  });

  it('p003_cancelled_navigation_and_illegal_dates_emit_nothing', async () => {
    /* 两道兜底：用户在有未保存改动时点取消；日期不合法（未来的日子）——
       与 `AppShell.openHistoryForDate` 同一口径。后者是网关直接放行的
       （见上一条 p003_blank_date_key_is_filtered_by_the_consumer_not_the_gateway）。 */
    respondWith({ history: { dateKey: '2026-11-10', focusApp: 'Code.exe' } });
    expect(mount({ navigated: false }).state.request).toBeNull();
    await flush();

    respondWith({ history: { dateKey: '2999-01-01', focusApp: 'Code.exe' } });
    const second = mount();
    await flush();
    expect(second.navigate).not.toHaveBeenCalled();
    expect(second.state.request).toBeNull();
  });
});

describe('History 的高亮键是纯派生（源码级）', () => {
  /* 派生比较是**内联在组件体内**的表达式，没法单独 import 来测；沿用 B1/B2 的先例
     （`useThemeWiring.source.test.ts`、`settingsConvergence.source.test.ts`）钉源码文本。 */
  it('p003_highlight_requires_requested_day_to_be_presented_and_reads_focus_app', () => {
    const assignment = /const highlightedApp = ([\s\S]*?);\n/.exec(HISTORY_SRC);
    expect(assignment, '找不到 History.tsx 的 highlightedApp 派生').not.toBeNull();
    const expr = assignment![1].replace(/\s+/g, ' ');

    expect(expr, '「请求日期 == 当前呈现日期」同时兼任生效范围与自动失效')
      .toContain('visibleDateKey === selectedDateRequest.dateKey');
    expect(expr, '高亮键必须取自这次请求的 focusApp，恒 null 就是"永不亮"')
      .toContain('selectedDateRequest.focusApp ?? null');
  });

  it('p003_highlight_is_handed_to_both_tracks_and_the_whole_request_is_passed_down', () => {
    const handed = HISTORY_SRC.match(/highlightSourceKey=\{highlightedApp\}/g) ?? [];
    expect(handed, '总览轨与 Timing 泳道必须都拿到 highlightedApp').toHaveLength(2);
    expect(APP_SHELL_SRC, '挑字段传会把 focusApp 静默丢掉').toContain('selectedDateRequest={historyDateRequest}');
    expect(APP_SHELL_SRC).not.toMatch(/selectedDateRequest=\{\{\s*dateKey/);
  });
});
