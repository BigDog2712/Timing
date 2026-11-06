/**
 * Timing — 浏览器降级 Mock：插件域 + Markdown 同步（V0.11.5，6 条）
 * -----------------------------------------------------------------------------
 * 纯浏览器没有 `%APPDATA%` 可扫，也没有真实文件系统。这里内置一个 v1 插件与
 * 内核默认的三档落点，让「设置 → 插件」「设置 → 同步」都能在浏览器里走查：
 * - 插件页展示 v1 的 `quickTimers` 贡献（v3 起没有 mdSync 贡献点）；
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

/* [V0.11.6] 出厂落点是便携的 `<exe>\plugins`（ADR-050 §1）；这里写占位口径，
   与设置页里真实显示的路径形状一致，不泄露任何本机目录结构。 */
const MOCK_DIR = '%APP_DIR%\\plugins';
/* 落点根目录：仅用于浏览器走查的**占位**路径（不泄露任何本机目录结构）。
   [V0.11.6] 出厂默认值改为 `%APP_DIR%\md`（数据根，见 ADR-050 §5）；浏览器里
   `app_dir` 未注入 → `resolve_path` 会退回 appdata 口径。mock 只用于展示，可接受。 */
const MOCK_ROOT = '%APP_DIR%\\md';

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

/* 落点默认值：与内核 `default_bindings()` 同形（同步已是内核功能，不再由插件声明）。
   `enabled` 这里给 true 是为走查方便（否则一进页面落点设置是收起的）。 */
let config: MdSyncConfig = {
  enabled: true,
  pollSecs: 900,
  bindings: DEFAULT_BINDINGS.map((binding) => ({ ...binding })),
};

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
