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
  MdBackupItem,
  MdSyncBinding,
  MdSyncCloud,
  MdSyncCloudStatus,
  MdSyncConfig,
  MdSyncKind,
  MdSyncReport,
  MdSyncTestResult,
  MdSyncViewCloud,
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
   `enabled` 这里给 true 是为走查方便（否则一进页面落点设置是收起的）。

   [V0.11.13] `cloud` 给一个**未启用**的本地目录模板而不是 `null`：`null` 是「老配置、
   从没进过云端页」的口径，浏览器里那块就永远渲染不出来，等于没得走查。真机上老用户
   看到的是 `null`，设置页必须两种都能显示（T05）。 */
let config: MdSyncConfig = {
  enabled: true,
  pollSecs: 900,
  bindings: DEFAULT_BINDINGS.map((binding) => ({ ...binding })),
  cloud: {
    enabled: false,
    mode: 'localfolder',
    localRoot: '',
    baseUrl: '',
    basePath: '',
    user: '',
  },
};

/* [V0.11.13] 密码只有一个 bool 可走查：mock 不存、也不回显明文（与真机一致）。 */
let hasSecret = false;

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

/* [V0.11.13] 云端状态纯由配置 + `hasSecret` 推出来，不臆造「今天已上传」：
   浏览器里没有任何东西真的传过，谎报成功会让走查得出错误结论。 */
function cloudStatus(): MdSyncCloudStatus {
  const cloud: MdSyncCloud | null = config.cloud;
  return {
    enabled: Boolean(cloud?.enabled),
    mode: cloud?.mode ?? 'localfolder',
    hasSecret,
    todayPushed: false,
    pendingDates: [],
    lastError: null,
  };
}

function view(): MdSyncViewCloud {
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
    cloud: cloudStatus(),
  };
}

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

/* [V0.11.13] 备份列表：两条常量事实。第二条 `target: null` 代表老备份（文件名无归属
   前缀），列表要能标出「归属未知」并让用户自己选恢复目标。 */
const MOCK_BACKUPS: MdBackupItem[] = [
  {
    name: 'obsidian__2026-11-05.md',
    target: 'obsidian',
    source: '2026-11-05.md',
    date: '2026-11-05',
    atMs: 1762340000000,
    bytes: 4096,
  },
  {
    name: 'before-upgrade.md',
    target: null,
    source: '2026-11-03.md',
    date: '2026-11-03',
    atMs: 1762170000000,
    bytes: 2048,
  },
];

export function createMockApiPlugins(): Record<string, (args?: unknown) => unknown> {
  return {
    plugin_list: () => result(),
    plugin_open_dir: () => undefined,
    md_sync_get: () => view(),
    md_sync_save: (args) => {
      const payload = args as { config?: MdSyncConfig; secret?: string | null } | undefined;
      const next = payload?.config;
      if (!next || !Array.isArray(next.bindings)) {
        fail('MD_SYNC_CONFIG_INVALID', '同步设置不合法：缺少落点');
      }
      for (const binding of next.bindings) {
        if (!binding.file.trim() || !binding.heading.trim().startsWith('#')) {
          fail('MD_SYNC_CONFIG_INVALID', '同步设置不合法：文件或标题为空');
        }
      }
      config = next;
      /* [V0.11.13] 三分语义在 mock 里只落到一个 bool：`undefined` = 没碰密码框（保留），
         空串 = 用户清空，非空 = 已设置。明文不进 mock 的任何状态，与真机同口径。 */
      if (typeof payload?.secret === 'string') hasSecret = payload.secret.length > 0;
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
    /* [V0.11.13] 测试连接：真机上 `detail` 是人话（不是 HTTP 状态码），mock 照这个口径
       给，走查时看到的就是用户会看到的那句话。 */
    md_sync_test: (args): MdSyncTestResult => {
      const cloud = (args as { config?: MdSyncConfig } | undefined)?.config?.cloud;
      if (!cloud || !cloud.enabled) return { ok: false, detail: '还没开启云端通道' };
      if (cloud.mode === 'localfolder') {
        const root = cloud.localRoot.trim();
        return root
          ? { ok: true, detail: `目录可写：${root}` }
          : { ok: false, detail: '请选择云端通道的本地目录' };
      }
      if (!cloud.baseUrl.trim()) return { ok: false, detail: '请填写 WebDAV 服务地址' };
      if (!cloud.user.trim()) return { ok: false, detail: '请填写 WebDAV 账号' };
      return { ok: true, detail: '连接正常（浏览器 mock，没有真的发请求）' };
    },
    md_backup_list: (): MdBackupItem[] => MOCK_BACKUPS,
    md_backup_restore: (args) => {
      const name = (args as { name?: string } | undefined)?.name ?? '';
      const item = MOCK_BACKUPS.find((backup) => backup.name === name);
      if (!item) fail('MD_SYNC_CONFIG_INVALID', `「${name}」不是 Timing 的备份文件`);
      if (!item.date) fail('MD_SYNC_CONFIG_INVALID', `「${name}」读不出日期`);
      return { date: item.date, target: item.target, imported: 3, written: 1 };
    },
    /* [V0.11.15] 数据根三条 + 备份「打开」。
       `change(null)` = 撤销：把 pending 清掉，与真机「改写/删除指针」同口径。 */
    data_root_get: () => dataRootInfo(),
    data_root_change: (args) => {
      const path = (args as { path?: string | null } | undefined)?.path ?? null;
      mockPending = path;
      return dataRootInfo();
    },
    data_root_open: () => undefined,
    md_backup_open: (args) => {
      const name = (args as { name?: string } | undefined)?.name ?? '';
      if (!MOCK_BACKUPS.some((backup) => backup.name === name)) {
        /* 与真机同一句原文：走查时「删掉备份再点打开」要能看到这句话（PRD D2）。 */
        fail('IO_ERROR', `文件不存在：${name}`);
      }
      return undefined;
    },
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
