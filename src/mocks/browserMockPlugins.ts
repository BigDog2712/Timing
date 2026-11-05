/**
 * TickBar — 浏览器降级 Mock：插件域 + Markdown 同步（V0.4.0，6 条）
 * -----------------------------------------------------------------------------
 * 纯浏览器没有 `%APPDATA%` 可扫，也没有真实文件系统。这里内置一个 md-sync 插件
 * 与两个落点，让「设置 → 插件」「设置 → 同步」都能在浏览器里走查：
 * - 插件页展示 v2 贡献点；
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
  PluginInfo,
  PluginListResult,
} from '../types/domain';
import { fail } from './mockSeed';

const MOCK_DIR = '%APPDATA%\\com.timing.app\\plugins';
/* 落点根目录：仅用于浏览器走查的**占位**路径（不泄露任何本机目录结构） */
const MOCK_ROOT = '%USERPROFILE%\\Documents\\Timing';

const PRESETS = [
  { item: '上厕所', minutes: 10 },
  { item: '摸鱼', minutes: 25 },
  { item: '吃饭', minutes: 60 },
];

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

const PLUGIN: PluginInfo = {
  id: 'md-sync',
  name: 'Markdown 同步',
  version: '1.0.0',
  apiVersion: 2,
  description: '把 TickBar 的计时与便利贴同步到 Obsidian 日记；改 Markdown 也会写回数据库。',
  source: 'dev',
  dir: `${MOCK_DIR}\\md-sync`,
  enabled: true,
  error: null,
  quickTimers: [],
  mdSync: { bindings: DEFAULT_BINDINGS },
};

function today(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function view(): MdSyncView {
  const date = today();
  return {
    installed: true,
    pluginId: PLUGIN.id,
    pluginName: PLUGIN.name,
    pluginVersion: PLUGIN.version,
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
    quickTimers: PRESETS,
  };
}

export function createMockApiPlugins(): Record<string, (args?: unknown) => unknown> {
  return {
    plugin_list: () => result(),
    plugin_open_dir: () => undefined,
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
