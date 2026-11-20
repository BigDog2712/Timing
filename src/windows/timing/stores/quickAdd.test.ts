/**
 * Timing — 药丸快捷新建的两个草稿 store 判据（0.13.x）
 * -----------------------------------------------------------------------------
 * `quickAddStore`：名称 / 标签 / 应用成对读写，`reset` 是下次开新流程的干净起点。
 * `recentApps`：`normalizeAppKey` 的产物做键；exe 路径只留展示名；自家进程不收；
 * 同键去重提到最前；最多 8 条。键错了就绑不上 `item_app`，所以这几条都得钉住。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useQuickAddStore } from './quickAddStore';
import { useRecentAppsStore } from './recentApps';

describe('quickAddStore', () => {
  beforeEach(() => useQuickAddStore.getState().reset());

  it('名称 / 标签 / 应用分别落到草稿上', () => {
    const store = useQuickAddStore.getState();
    store.setName('写周报');
    store.setTags(['工作/周报']);
    store.setApp('code.exe', 'Code');

    const draft = useQuickAddStore.getState();
    expect(draft.name).toBe('写周报');
    expect(draft.tags).toEqual(['工作/周报']);
    expect(draft.appKey).toBe('code.exe');
    expect(draft.appLabel).toBe('Code');
  });

  it('setApp(null, null) = 取消绑定；reset 清空全部字段', () => {
    const store = useQuickAddStore.getState();
    store.setName('A');
    store.setTags(['生活']);
    store.setApp('code.exe', 'Code');
    store.setApp(null, null);
    expect(useQuickAddStore.getState().appKey).toBeNull();
    expect(useQuickAddStore.getState().appLabel).toBeNull();

    store.reset();
    expect(useQuickAddStore.getState()).toMatchObject({ name: '', tags: [], appKey: null, appLabel: null });
  });
});

describe('recentApps', () => {
  beforeEach(() => useRecentAppsStore.setState({ apps: [] }));

  it('键与 Rust 归一一致（带盘符的完整路径原样保留），展示名去掉目录与 .exe', () => {
    useRecentAppsStore.getState().note('"C:\\Program Files\\Microsoft VS Code\\Code.EXE"');
    expect(useRecentAppsStore.getState().apps).toEqual([
      { key: 'c:\\program files\\microsoft vs code\\code.exe', label: 'Code' },
    ]);
  });

  it('同键去重并提到最前（大小写不同算同一个应用）', () => {
    const { note } = useRecentAppsStore.getState();
    note('chrome.exe');
    note('Code');
    note('CHROME.EXE');
    expect(useRecentAppsStore.getState().apps.map((app) => app.key)).toEqual(['chrome.exe', 'code.exe']);
  });

  it('自家进程 / 空名不收', () => {
    const { note } = useRecentAppsStore.getState();
    note('timing.exe');
    note('');
    note('   ');
    expect(useRecentAppsStore.getState().apps).toEqual([]);
  });

  it('最多保留 8 条（最旧的被挤掉）', () => {
    const { note } = useRecentAppsStore.getState();
    for (let i = 0; i < 10; i += 1) note(`app${i}`);
    const apps = useRecentAppsStore.getState().apps;
    expect(apps).toHaveLength(8);
    expect(apps[0]?.key).toBe('app9.exe');
    expect(apps.some((app) => app.key === 'app0.exe')).toBe(false);
  });
});