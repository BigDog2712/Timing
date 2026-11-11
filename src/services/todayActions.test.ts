/**
 * 「今天」动作的单测（P0-03 药丸入口 → 记录面板 → 分析窗今天）
 * -----------------------------------------------------------------------------
 * 两个动作的**出口形状**是全链路里最容易悄悄错的一环：
 *  ① `openTodayPanel()` 必须真的打开 `records` 面板。这个面板在本轮之前**全仓 0 处调用**
 *     （`openPanel('records')` 无人调），也就是说「同时在用」这条融合可见物在 UI 上根本
 *     没有入口——补丁要钉住的正是「有人真的调了它」。
 *  ② `openTodayInAnalysis()` 发给宿主 `open_patina_window` 的 JSON 必须与 Rust 侧
 *     `PatinaOpenTarget`（`src-tauri/src/commands/window_cmd.rs`，`deny_unknown_fields`
 *     + `rename_all = "camelCase"`）逐字对齐：`{ target: { history: { dateKey, focusApp } } }`。
 *     拼错一个键 → 宿主侧反序列化报错 → 用户看到「没能打开分析窗」，且**日期永远是今天**
 *     这件事也没了。所以这里把整份载荷做精确对象断言，而不是「包含了 dateKey」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openPatinaWindowMock, errorTextMock } = vi.hoisted(() => ({
  openPatinaWindowMock: vi.fn(),
  errorTextMock: vi.fn((error: unknown) => String(error)),
}));

vi.mock('./ipc', () => ({
  errorText: errorTextMock,
  ipc: { openPatinaWindow: openPatinaWindowMock },
}));

import { todayDateKey } from '../lib/dateKey';
import { useUiStore } from '../stores/uiStore';
import {
  openDigestPanel,
  openOverviewInAnalysis,
  openTodayInAnalysis,
  openTodayPanel,
} from './todayActions.ts';

describe('openTodayPanel —— 药丸「今天」图标的落点', () => {
  beforeEach(() => {
    useUiStore.setState({ panel: 'none' });
  });

  it('p003_opens_the_records_panel', () => {
    expect(useUiStore.getState().panel).toBe('none');
    openTodayPanel();
    expect(useUiStore.getState().panel).toBe('records');
  });
});

describe('openDigestPanel —— 摘要面板的两条一步入口（P1-02 E1/E2）', () => {
  beforeEach(() => {
    useUiStore.setState({ panel: 'none' });
  });

  it('p102_opens_the_digest_panel', () => {
    /* 变异：把 `openPanel('digest')` 写成 `openPanel('records')` → 本用例红 */
    openDigestPanel();
    expect(useUiStore.getState().panel).toBe('digest');
  });
});

describe('openTodayInAnalysis —— 递给宿主的落点载荷', () => {
  beforeEach(() => {
    openPatinaWindowMock.mockReset();
    openPatinaWindowMock.mockResolvedValue(undefined);
    useUiStore.setState({ notice: null });
  });

  it('p003_sends_exactly_the_rust_patina_open_target_shape', async () => {
    await openTodayInAnalysis();
    expect(openPatinaWindowMock).toHaveBeenCalledTimes(1);
    /* 精确对象断言：`target.history.dateKey/focusApp` 少一个键、多一个键都要红。 */
    expect(openPatinaWindowMock).toHaveBeenCalledWith({
      target: { history: { dateKey: todayDateKey(), focusApp: null } },
    });
  });

  it('p003_carries_the_focus_app_through', async () => {
    await openTodayInAnalysis('Code.exe');
    expect(openPatinaWindowMock).toHaveBeenCalledWith({
      target: { history: { dateKey: todayDateKey(), focusApp: 'Code.exe' } },
    });
  });

  it('p003_uses_the_local_date_key_not_a_utc_one', () => {
    /* 「今天」只能有一个口径：宿主 `src/lib/dateKey.ts` 的本地日，
       与分析窗历史页同一个 `YYYY-MM-DD`。UTC 截断在东八区每天有 8 小时会落到前一天。 */
    expect(todayDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    expect(todayDateKey()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate(),
      ).padStart(2, '0')}`,
    );
  });

  it('p003_invoke_failure_becomes_a_danger_notice_and_never_throws', async () => {
    /* 落点通道失败（ACL / 序列化 / 运行时缺失）不能静默吞：用户需要知道「再点一次」。
       但也不能把 Promise 抛给调用方（按钮回调里没地方接）。 */
    openPatinaWindowMock.mockRejectedValueOnce(new Error('acl denied'));
    await expect(openTodayInAnalysis()).resolves.toBeUndefined();
    const notice = useUiStore.getState().notice;
    expect(notice?.tone).toBe('danger');
    expect(notice?.text).toContain('没能打开分析窗');
    expect(notice?.text).toContain('acl denied');
  });
});

describe('openOverviewInAnalysis —— 递给宿主的「总览」落点（P1-02 E4）', () => {
  beforeEach(() => {
    openPatinaWindowMock.mockReset();
    openPatinaWindowMock.mockResolvedValue(undefined);
    useUiStore.setState({ notice: null });
  });

  it('p102_sends_exactly_the_rust_overview_target_shape', async () => {
    /* 精确对象断言：Rust `PatinaOpenTarget` 是 `deny_unknown_fields` + camelCase，多一个键
       少一个键都会被宿主拒收（症状是「点了看总览，窗开了但停在默认页」）。 */
    await openOverviewInAnalysis();
    expect(openPatinaWindowMock).toHaveBeenCalledTimes(1);
    expect(openPatinaWindowMock).toHaveBeenCalledWith({ target: { overview: true } });
    /* 不许顺手带上历史落点：三键互斥，带上 dateKey 就变成「落 history」了。 */
    expect(openPatinaWindowMock.mock.calls[0]?.[0]).not.toHaveProperty('target.history');
  });

  it('p102_invoke_failure_becomes_a_danger_notice_and_never_throws', async () => {
    openPatinaWindowMock.mockRejectedValueOnce(new Error('acl denied'));
    await expect(openOverviewInAnalysis()).resolves.toBeUndefined();
    const notice = useUiStore.getState().notice;
    expect(notice?.tone).toBe('danger');
    expect(notice?.text).toContain('没能打开分析窗');
  });
});
