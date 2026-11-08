/**
 * Timing — 浏览器降级 Mock：插件域 + 数据根 + 原生能力（V0.11.5）
 * -----------------------------------------------------------------------------
 * 纯浏览器没有 `%APPDATA%` 可扫，也没有真实文件系统。这里内置一个 v1 插件、数据根的
 * 假状态与悬浮条 / SAF 的假事实，让「设置 → 插件」「设置 → 数据管理」都能在浏览器里走查。
 *
 * [V0.11.26] Markdown 同步那一摊（配置 / 视图 / 测试连接 / 备份）搬到
 * `browserMockMdSync.ts`：单文件 ≤300 行是硬门禁，而它们是两个域、两组用例各看各的。
 * 这里只负责把两边的 handler 拼成一张表（`browserMock.ts` 只认一个入口）。
 *
 * 桌面端仍以真实扫描结果为准；本文件只在 `isTauri() === false` 时被使用。
 */
import type { PluginInfo, PluginListResult } from '../types/domain';
import { createMockMdSyncApi } from './browserMockMdSync';

/* [V0.11.6] 出厂落点是便携的 `<exe>\plugins`（ADR-050 §1）；这里写占位口径，
   与设置页里真实显示的路径形状一致，不泄露任何本机目录结构。 */
const MOCK_DIR = '%APP_DIR%\\plugins';

const PRESETS = [
  { item: '上厕所', minutes: 10 },
  { item: '摸鱼', minutes: 25 },
  { item: '吃饭', minutes: 60 },
];

/* [v3] 示例插件换成 v1 的「摸鱼套装」：仓库里那个 `md-sync` 插件已删除，
若还挂着它，设置页会在浏览器里显示一个实际上已经不存在的东西。 */
const PLUGIN: PluginInfo = {
  id: 'moyu-kit',
  name: '摸鱼套装',
  version: '1.0.0',
  apiVersion: 1,
  description: '把「上厕所 / 摸鱼 / 吃饭」三条快捷计时按自己的时长覆盖一遍。',
  source: 'dev',
  dir: `${MOCK_DIR}\\moyu-kit`,
  enabled: true,
  error: null,
  quickTimers: PRESETS,
  warnings: [],
};

function result(): PluginListResult {
  return {
    dir: MOCK_DIR,
    plugins: [PLUGIN],
    quickTimers: PRESETS,
  };
}

/* [V0.11.15] 数据根的假状态：`current` 恒为出厂落点占位，`change` 只动 `pending`
   ——与真机同口径（写指针、**重启后**才生效），这样块②的待生效黄条能在浏览器里走查。 */
const MOCK_DATA_ROOT = '%APP_DIR%';
let mockPending: string | null = null;

function dataRootInfo(): Record<string, unknown> {
  return {
    current: MOCK_DATA_ROOT,
    defaultPath: MOCK_DATA_ROOT,
    isDefault: MOCK_DATA_ROOT === '%APP_DIR%',
    writable: true,
    writableError: null,
    pending: mockPending,
    previous: null,
    sizeBytes: 65_200_000,
    entries: [
      { name: 'timing.db', isDir: false, present: true, bytes: 18_400_000 },
      { name: 'backups', isDir: true, present: true, bytes: 42_100_000 },
      { name: 'logs', isDir: true, present: true, bytes: 3_200_000 },
      { name: 'md', isDir: true, present: true, bytes: 1_100_000 },
      { name: 'migrated-from-tickbar-app.json', isDir: false, present: false, bytes: 0 },
    ],
    affected: ['事项计时', '便利贴', '待办事项'],
    pluginsInDataRoot: false,
  };
}

/* [V0.12.0] 悬浮条开关的假状态：浏览器里没有前台服务，但设置页得能来回切。 */
let overlayOn = false;
let overlayStyle = 'dot';

export function createMockApiPlugins(): Record<string, (args?: unknown) => unknown> {
  return {
    plugin_list: () => result(),
    plugin_open_dir: () => undefined,
    ...createMockMdSyncApi(),
    /* [V0.11.15] 数据根三条。
       `change(null)` = 撤销：把 pending 清掉，与真机「改写/删除指针」同口径。 */
    data_root_get: () => dataRootInfo(),
    data_root_change: (args) => {
      const path = (args as { path?: string | null } | undefined)?.path ?? null;
      mockPending = path;
      return dataRootInfo();
    },
    data_root_open: () => undefined,
    /* [V0.12.0] 手机端原生能力：浏览器给「已授权 + 悬浮条可开」的假事实，
       让两个入口都能走查（真机上这两个值来自 Kotlin）。 */
    md_saf_pick: () => ({ granted: true, label: 'Mock/Vault · …' }),
    md_saf_status: () => ({ granted: true, label: 'Mock/Vault · …' }),
    overlay_set: (args) => {
      const next = args as { enabled?: boolean; style?: string } | undefined;
      overlayOn = Boolean(next?.enabled);
      if (next?.style === 'dot' || next?.style === 'bar') overlayStyle = next.style;
      return { permitted: true, enabled: overlayOn, style: overlayStyle };
    },
    overlay_status: () => ({ permitted: true, enabled: overlayOn, style: overlayStyle }),
  };
}
