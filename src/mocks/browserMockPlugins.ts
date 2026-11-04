/**
 * Timing — 浏览器降级 Mock：插件域 + Markdown 同步（V0.4.0，6 条）
 * -----------------------------------------------------------------------------
 * 纯浏览器没有 `%APPDATA%` 可扫，也没有真实文件系统。这里造一个示例插件与三条
 * 出厂落点，让「设置 → 插件」「设置 → 同步」都能在浏览器里走查：
 * - 插件页展示 `quickTimers` 贡献点（插件已不再贡献同步落点）；
 * - 同步页可改根目录 / 文件 / 标题、保存、立即同步（返回假报告）；
 * - 落点路径只是预览，不会真的写文件。
 *
 * 桌面端仍以真实扫描结果为准；本文件只在 `isTauri() === false` 时被使用。
 */
import type {
  MdSyncBinding,
  MdSyncConfig,
  MdSyncKind,
  MdSyncReport,
  MdSyncView,
  PanelRow,
  PluginInfo,
  PluginListResult,
} from '../types/domain';
import { fail } from './mockSeed';

const MOCK_DIR = '%APPDATA%\\com.timing.app\\plugins';
const MOCK_ROOT = '%USERPROFILE%\\OneDrive\\应用\\remotely-save\\Elio\\1-MemeX\\Diary';

const DEFAULT_BINDINGS: MdSyncBinding[] = [
  {
    kind: 'timers',
    enabled: true,
    root: MOCK_ROOT,
    file: '{date}.md',
    heading: '#### 事项计时',
  },
  {
    kind: 'notes',
    enabled: true,
    root: MOCK_ROOT,
    file: '{date}.md',
    heading: '#### 便利贴',
  },
  {
    kind: 'todos',
    enabled: true,
    root: MOCK_ROOT,
    file: '{date}.md',
    heading: '#### 待办事项',
  },
];

let config: MdSyncConfig = {
  enabled: true,
  bindings: DEFAULT_BINDINGS.map((binding) => ({ ...binding })),
};

/* 示例插件：演示「插件能做什么」。同步落点不在其中——那是宿主内建功能。 */
const PLUGIN: PluginInfo = {
  id: 'moyu-kit',
  name: '摸鱼套装',
  version: '1.0.0',
  apiVersion: 3,
  description: '给摸鱼菜单加两条更狠的预设，并提供一个本周概览面板。',
  source: 'user',
  dir: `${MOCK_DIR}\\moyu-kit`,
  enabled: true,
  error: null,
  quickTimers: [
    { item: '上厕所', minutes: 10 },
    { item: '摸鱼', minutes: 25 },
  ],
  panels: [
    {
      id: 'weekly',
      title: '本周概览',
      blocks: [
        { type: 'text', text: '按事项统计最近 7 天的投入，点按钮可以直接开始计时。' },
        { type: 'stats', source: 'records.byItem', label: '各事项', params: { days: 7 } },
        { type: 'list', source: 'todos.pending', label: '待办', params: { limit: 5 } },
        {
          type: 'actions',
          items: [
            { label: '开始摸鱼', action: 'timer.start', params: { item: '摸鱼' } },
          ],
        },
      ],
    },
  ],
};

function today(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function view(): MdSyncView {
  const date = today();
  return {
    today: date,
    config,
    status: {
      lastSyncAt: null,
      lastError: null,
      bindings: config.bindings.map((binding) => ({
        kind: binding.kind,
        path: `${binding.root}\\${binding.file.replace('{date}', date)}`,
        exists: false,
        lastError: null,
        lastSyncAt: null,
        lastDirection: null,
      })),
    },
  };
}

function result(): PluginListResult {
  return {
    dir: MOCK_DIR,
    plugins: [PLUGIN],
    quickTimers: PLUGIN.quickTimers,
  };
}

export function createMockApiPlugins(): Record<string, (args?: unknown) => unknown> {
  return {
    plugin_list: () => result(),
    plugin_open_dir: () => undefined,
    /* 浏览器里没有第二扇窗可开：把身份打到控制台，让走查的人知道点到了什么。 */
    plugin_panel_open: (args) => {
      const params = args as { pluginId?: string; panelId?: string } | undefined;
      console.info('[mock] 打开插件面板', params?.pluginId, params?.panelId);
      return undefined;
    },
    plugin_panel_data: (args): PanelRow[] => {
      const source = (args as { source?: string } | undefined)?.source;
      if (source === 'records.byItem') {
        return [
          { label: '摸鱼', detail: '3 小时 20 分', ratio: 1 },
          { label: '写代码', detail: '2 小时', ratio: 0.6 },
          { label: '喝水', detail: '12 分', ratio: 0.06 },
        ];
      }
      if (source === 'todos.pending') {
        return [
          { label: '喝水', detail: '今天', ratio: null },
          { label: '写周报', detail: '明天', ratio: null },
        ];
      }
      return [];
    },
    plugin_action_run: (args) => ({
      message: `（浏览器演示）已执行 ${(args as { action?: string } | undefined)?.action ?? ''}`,
    }),
    md_sync_get: () => view(),
    md_sync_save: (args) => {
      const next = (args as { config?: MdSyncConfig } | undefined)?.config;
      if (!next || !Array.isArray(next.bindings)) {
        fail('MD_SYNC_CONFIG_INVALID', '同步设置不合法：缺少落点');
      }
      for (const binding of next.bindings) {
        if (!binding.file.trim() || !binding.heading.trim().startsWith('#')) {
          fail('MD_SYNC_CONFIG_INVALID', '同步设置不合法：文件或标题为空');
        }
      }
      config = next;
      return view();
    },
    md_sync_run: (): MdSyncReport => ({
      at: Date.now(),
      exported: config.bindings.filter((binding) => binding.enabled).length,
      imported: 0,
      kinds: [] as MdSyncKind[],
      errors: [],
    }),
    md_sync_open: () => undefined,
  };
}
