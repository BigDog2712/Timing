/**
 * Timing — 浏览器降级 Mock：Markdown 同步那一摊（V0.11.5；[V0.11.26] 从 `browserMockPlugins` 拆出）
 * -----------------------------------------------------------------------------
 * 纯浏览器没有 `%APPDATA%` 可扫，也没有真实文件系统。这里内置一套「配置 + 视图 + 备份」
 * 的假事实，让「设置 → 数据管理」在浏览器里能完整走查：改落点 / 改两条通路 / 保存 /
 * 立即同步（返回假报告）/ 测试连接（返回人话）/ 备份列表与恢复。
 *
 * 为什么拆出来：单文件 ≤300 行是硬门禁（ADR-017，零豁免），而插件页与同步页是两个域、
 * 两组用例各看各的。**判据不变**：mock 只用于走查，桌面端仍以真实扫描与真实文件系统为准。
 *
 * 三条纪律：
 * 1. **不臆造成功**：浏览器里什么都没真的传过、写过，所以 `todayPushed` 恒 `false`、
 *    `exists` 恒 `false`、`exported` 只按「开着的落点数」算——谎报会让走查得出错误结论；
 * 2. **文案与真机同口径**：`md_sync_test` 回的 `detail` 是人话（不是 HTTP 状态码），
 *    与 `probe.rs` 的三关文案逐字对齐；
 * 3. **新保存形**（V0.11.26）：`cloudFolder` / `cloudWebdav` 各一份，legacy `cloud` 显式
 *    `null`（真实后端会把这个键整个省掉，这里写 `null` 是为了让类型成立且走查同形）。
 */
import type {
  CloudMode,
  MdBackupItem,
  MdSyncBinding,
  MdSyncCloudChannel,
  MdSyncCloudStatus,
  MdSyncConfig,
  MdSyncKind,
  MdSyncReport,
  MdSyncTestResult,
  MdSyncViewCloud,
} from '../types/domain';
import { fail } from './mockSeed';

/* 落点根目录：仅用于浏览器走查的**占位**路径（不泄露任何本机目录结构）。
   [V0.11.6] 出厂默认值改为 `%APP_DIR%\md`（数据根，见 ADR-050 §5）。 */
const MOCK_ROOT = '%APP_DIR%\\md';

const DEFAULT_BINDINGS: MdSyncBinding[] = [
  { kind: 'timers', enabled: true, root: MOCK_ROOT, file: '{date}.md', heading: '#### 事项计时' },
  { kind: 'notes', enabled: true, root: MOCK_ROOT, file: '{date}.md', heading: '#### 便利贴' },
  { kind: 'todos', enabled: true, root: MOCK_ROOT, file: '{date}.md', heading: '#### 待办事项' },
];

/* 落点默认值：与内核 `default_bindings()` 同形（同步已是内核功能，不再由插件声明）。
   `enabled` 这里给 true 是为走查方便（否则一进页面落点设置是收起的）。

   [V0.11.26] 两条通路各给一份**未启用**的模板（`enabled: false`）：
   `null` 是「从没配过」的口径，浏览器里两块就永远渲染不出状态行，等于没得走查；
   真机上从未配置的用户看到的是缺键，设置页必须两种都能显示。 */
let config: MdSyncConfig = {
  enabled: true,
  pollSecs: 900,
  bindings: DEFAULT_BINDINGS.map((binding) => ({ ...binding })),
  cloud: null,
  cloudFolder: {
    enabled: false,
    localRoot: '',
    auto: { schedule: 'smart', intervalMinutes: 15 },
  },
  cloudWebdav: {
    enabled: false,
    baseUrl: 'https://dav.jianguoyun.com/dav/',
    basePath: '/Timing',
    user: '',
    auto: { schedule: 'smart', intervalMinutes: 15 },
  },
};

/* [V0.11.13] 密码只有一个 bool 可走查：mock 不存、也不回显明文（与真机一致）。 */
let hasSecret = false;

function today(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* 通路状态纯由配置 + `hasSecret` 推出来，不臆造「今天已上传」。
   [V0.11.26] 按通路各投一份（块④ 读 `local`、块⑤ 读 `cloud`），`mode` 由调用方给。 */
function channelStatus(
  channel: MdSyncCloudChannel | null | undefined,
  mode: CloudMode,
): MdSyncCloudStatus {
  return {
    enabled: Boolean(channel?.enabled),
    mode,
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
    cloud: channelStatus(config.cloudWebdav, 'webdav'),
    local: channelStatus(config.cloudFolder, 'localfolder'),
  };
}

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

/** Markdown 同步 / 备份 / 测试连接这一摊的假 handler（`browserMock` 里 spread 进总表）。 */
export function createMockMdSyncApi(): Record<string, (args?: unknown) => unknown> {
  return {
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
    /* 测试连接：真机上 `detail` 是人话（不是 HTTP 状态码），mock 照这个口径给。
       [V0.11.26] 载荷仍是 legacy `cloud`（`probe.rs` 零 diff 的前提）：块④ 传
       `mode: 'localfolder'`、块⑤ 传 `mode: 'webdav'`，`enabled` 恒 true。 */
    md_sync_test: (args): MdSyncTestResult => {
      const cloud = (args as { config?: MdSyncConfig } | undefined)?.config?.cloud;
      if (!cloud) return { ok: false, detail: '还没配置云端通道' };
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
    md_backup_open: (args) => {
      const name = (args as { name?: string } | undefined)?.name ?? '';
      if (!MOCK_BACKUPS.some((backup) => backup.name === name)) {
        /* 与真机同一句原文：走查时「删掉备份再点打开」要能看到这句话（PRD D2）。 */
        fail('IO_ERROR', `文件不存在：${name}`);
      }
      return undefined;
    },
    /* [V0.11.23] 导出备份：浏览器里没有「保存到…」，直接回「已保存」并回显去掉前缀的名字，
       让走查能看到成功那一句（失败与取消两条路要真机才走得出来）。 */
    md_backup_export: (args) => {
      const name = (args as { name?: string } | undefined)?.name ?? '';
      if (!MOCK_BACKUPS.some((backup) => backup.name === name)) {
        fail('IO_ERROR', `这份备份已经不在了（备份只保留最近 30 份）：${name}`);
      }
      return { saved: true, name: name.replace(/^[a-z]+__/, '') };
    },
  };
}
