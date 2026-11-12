/**
 * Timing — 设置 · 同步 · 配置小口径（V0.11.13）
 * -----------------------------------------------------------------------------
 * 从 `MdSyncTab` / `useMdSyncDraft` 里抽出来的**唯一一份**数字与字符串口径：
 * 云端通道空配置、校验原文就地定位、字节格式化。
 * [V0.11.19 批 1] 块③「同步间隔」整行删除后，那一族「分钟↔秒换算 / 夹值 /
 * 间隔文案」函数全部退场；分钟数的夹值口径搬到 `mdSyncAuto.ts`
 * （那边是云端三档的 5–120 分钟，与 md 同步无关）。
 * [V0.11.15] 再加三类纯函数：模板展开（`previewFile` / `subDirOf`）、后端校验原文的
 * 就地定位（`splitBindingError`）、字节格式化（`formatBytes`）。它们都只做「把一份输入
 * 变成另一份字符串」，同样不读 state、不碰网络。
 *
 * 为什么不各写一份：保存按一处算、「测试连接」按另一处算，很快就出现「测试通过、保存后
 * 不生效」这类没人能复现的故障。本文件是纯函数，不读 state、不碰网络。
 */
import type {
  CloudMode,
  MdSyncBinding,
  MdSyncBindingStatus,
  MdSyncCloud,
  MdSyncCloudChannel,
} from '../dto/hostTypes';

/**
 * 后端 `models/constants.rs::MD_SYNC_POLL_SECS` 的镜像，**只作占位**。
 * [V0.11.19] 界面上已经没有 `pollSecs` 的入口：保存与「测试连接」都必须取
 * `view.config.pollSecs` 落库原值透传（PRD §15.2）。这里的值只在「视图还没回来」
 * 那一瞬间用来让类型有个数；`useMdSyncDraft.save()` 开头的 `if (!view) return false;`
 * 保证它**绝不会被写回库**。
 */
export const MD_SYNC_POLL_SECS = 900;

/* [V0.11.26] 两条通路各自的空配置。
   `enabled` 必须是 `false`——视图没加载时凭空给 `true`，用户下一次保存就会把这条通路
   偷偷打开。`false` 也是 PRD A1 的默认态（两条通路都关着 = 只写 Obsidian 那份）。
   预填值（服务地址 + 远端目录）沿用 [V0.11.16] 的裁定：最常见的那台服务器开箱可用，
   而预填值存在但不在用户眼前等于没做到，所以直接写进值里。
   `%` 一律不出现：中文路径存中文、显示中文，编码交给 `url` crate 在发请求时做一次。
   [V0.11.17] B3：`basePath` 从 `/我的坚果云/Timing` 改成 `/Timing`——坚果云的 `dav` 根
   就是「我的坚果云」，`/Timing` 是它下面那一级；配套提示见 `mdSyncCopy.ts::CLOUD_DIR_HINT`。 */
export function emptyWebdav(): MdSyncCloudChannel {
  return {
    enabled: false,
    baseUrl: 'https://dav.jianguoyun.com/dav/',
    basePath: '/Timing',
    user: '',
  };
}

/** 块④ 本地同步的空配置：`enabled: false` 的理由同上；落点目录**不给默认值**（没有「常见目录」）。 */
export function emptyLocal(): MdSyncCloudChannel {
  return { enabled: false, localRoot: '' };
}

/**
 * [V0.11.26] 「从没配过云端」那一档的空配置 —— **只服务手机端面板与 legacy 载荷**。
 *
 * 桌面已经不用它了（块⑤ 用 `emptyWebdav()`）。留着这个导出是因为
 * `components/mobile/SyncCloudPane.tsx` 是零 diff 红线，它读的仍是 `config.cloud`。
 *
 * @deprecated 桌面请用 `emptyWebdav()` / `emptyLocal()`。
 */
export function emptyCloud(): MdSyncCloud {
  return {
    enabled: false,
    mode: 'webdav',
    localRoot: '',
    baseUrl: 'https://dav.jianguoyun.com/dav/',
    basePath: '/Timing',
    user: '',
  };
}

/**
 * [V0.11.26] 保存前归一（**逐通路**，承接原 `cloudToSave` 的防空壳职责）。
 *
 * `wasConfigured === false`（这条通路从未落库）且用户最终停在这个通路的「关」→ 落 `null`，
 * 让这类用户的库与新装同形；配过的人一概不归一（CH4 的继承者：关掉不删配置）。
 *
 * 不这么做的后果很具体：从没配过云端的人打开块⑤ 又关掉开关就保存，落库会从「没有这个键」
 * 变成 `{enabled:false, baseUrl:'https://dav.jianguoyun.com/dav/', …}` ——库里多出一个
 * 「像是配过」的对象。两条通路都做这件事，所以「两块都从未配置且都关」时 JSON 与新装同形（O13）。
 *
 * `wasConfigured` 取**保存动作那一刻的视图值**（`view.config.cloudFolder != null`），
 * 不是草稿：草稿里的通路永远非空，判不出「从没配过」。
 */
export function channelToSave(
  channel: MdSyncCloudChannel,
  wasConfigured: boolean,
): MdSyncCloudChannel | null {
  if (wasConfigured || channel.enabled) return channel;
  return null;
}

/**
 * 块④ 是否「开了且填了落点目录」——`云端目录还没填，暂时不会同步。`（L4）的判据。
 *
 * **与后端 `models/md_sync_channel.rs::is_usable_folder` 同口径，改一边必须改另一边**：
 * `enabled` 为假 → 不可用；`localRoot` 去空白后为空 → 不可用。
 */
export function isLocalReady(channel: Pick<MdSyncCloudChannel, 'enabled' | 'localRoot'>): boolean {
  if (!channel.enabled) return false;
  return (channel.localRoot ?? '').trim() !== '';
}

/**
 * 块⑤ 是否「开了且三件套齐」——`云端还没填全，暂时不会同步。` 的判据。
 *
 * **与后端 `is_usable_webdav` 同口径**：`baseUrl` / `basePath` / `user` **三个都要**非空白。
 * 密码**不参与**：它不在通路结构里（密文归 `infra::secret`），后端这一判也不看它——
 * 「有账号没密码」在界面上仍算「填全」，真正的失败由「测试连接」/ `lastError` 说。
 *
 * 三处都用 `.trim()` 判空白串：用户敲一个空格不等于填了。
 */
export function isWebdavReady(
  channel: Pick<MdSyncCloudChannel, 'enabled' | 'baseUrl' | 'basePath' | 'user'>,
): boolean {
  if (!channel.enabled) return false;
  return (
    (channel.baseUrl ?? '').trim() !== ''
    && (channel.basePath ?? '').trim() !== ''
    && (channel.user ?? '').trim() !== ''
  );
}

/**
 * 通路 → 「测试连接」的 legacy 载荷（`probe.rs` 是红线文件，只认带 `mode` 的旧形状）。
 *
 * `enabled` **恒 `true`**：探测是只读动作，不该被开关拦（PRD §4.3「测试连接保持可点」，
 * 设计 §四-4 同裁定）。地址/目录/账号原样带过去，缺项由后端给既有的错误文案。
 *
 * `mode` 由调用方给（块④ `localfolder`、块⑤ `webdav`）——去 mode 的通路结构里没有这个信息。
 */
export function legacyCloudForTest(
  mode: CloudMode,
  channel: MdSyncCloudChannel,
): MdSyncCloud {
  return {
    enabled: true,
    mode,
    localRoot: channel.localRoot ?? '',
    baseUrl: channel.baseUrl ?? '',
    basePath: channel.basePath ?? '',
    user: channel.user ?? '',
    auto: channel.auto,
  };
}

/**
 * [V0.11.26] legacy `MdSyncCloud` 是否「开了且填全」——**只服务手机端两个红线面板**。
 *
 * 桌面已改成 `isLocalReady / isWebdavReady` 两条通路各判一次；这里按 `mode` 分派到那两个
 * 函数，保证「同一份判据」而不是第二份实现。
 *
 * @deprecated 桌面请用 `isLocalReady` / `isWebdavReady`。
 */
export function isCloudReady(cloud: MdSyncCloud): boolean {
  return cloud.mode === 'localfolder' ? isLocalReady(cloud) : isWebdavReady(cloud);
}

/**
 * 文件模板展开（`{date}` / `{yyyy}` / `{MM}` / `{dd}` → 今天）。
 *
 * [V0.11.15] 从 `MdSyncBindingCard` 提上来：拆块之后 ①（只读预览）与 ③（每行路径）
 * 都要展开同一份模板，两处各写一遍 4 个 `replace` 迟早不一致——用户在 ① 看到
 * `2026-11-07.md`、在 ③ 看到 `2026-11-8.md` 时没人说得清哪个是真的。
 */
export function previewFile(file: string, today: string): string {
  return file
    .replace(/\{date\}/g, today)
    .replace(/\{yyyy\}/g, today.slice(0, 4))
    .replace(/\{MM\}/g, today.slice(5, 7))
    .replace(/\{dd\}/g, today.slice(8, 10));
}

/**
 * 模板带 `/` 时，展开结果里「文件名」之前的那几段就是会被建出来的子目录
 * （`Diary/{yyyy}/{date}.md` → `Diary/2026`）。没有 `/` → `null`（不显示这句话）。
 *
 * [V0.11.16] 块① 不再有「会建子目录 …」那一行（C7 收成一行「今天：…」），所以本函数
 * 目前**没有调用方**。**保留它**：它编码的是「模板允许带 / 建子目录」这条仍然生效的
 * 规则（后端 `md_file::expand_tokens` 照建），下一轮若要重新提示子目录，判据已经在这里。
 */
export function subDirOf(file: string, today: string): string | null {
  const expanded = previewFile(file, today);
  const at = expanded.lastIndexOf('/');
  return at > 0 ? expanded.slice(0, at) : null;
}

/** 第几个落点（1 起）→ 后端 `MdSyncBinding::validate` 给的前缀：`第 2 个落点：文件模板不能包含 ..` */
const BINDING_ERROR = /^第\s*(\d+)\s*个落点\s*[:：]\s*([\s\S]+)$/;

/**
 * 把后端那条「第 N 个落点：xxx」拆成「哪一行 + 说什么」，让红字落在出错的那一行下方。
 *
 * 返回 `null` = 不是这种形状（例如「请填写 WebDAV 服务地址」）→ 调用方退回页签顶部的
 * 全局红字。**不做二次解析、不猜**：猜错比不猜更糟，用户会去改一行根本没问题的输入。
 */
export function splitBindingError(
  message: string,
  count: number,
): { index: number; text: string } | null {
  const matched = BINDING_ERROR.exec(message.trim());
  if (!matched) return null;
  const index = Number.parseInt(matched[1], 10) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  return { index, text: matched[2].trim() };
}

/**
 * 字节 → 人话。备份行与数据根五项共用一份（`0 B` 与「没有这一项」是两件事，
 * `present: false` 的判断由调用方自己做，本函数只管数字）。
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * [V0.11.16] 运行状态的**唯一词表**：`export` / `import` / 其余 各一句，别处不许另写一份。
 *
 * 从 `MdSyncPathRow` 提上来（那里原本有一个私有的 `statusText`）：逐档面板与块③的
 * 聚合行必须说同一套话，否则「便利贴那行写「无变化」、上面聚合行写「已写入 Markdown」」
 * 这种自相矛盾的界面就会出现。
 */
export function directionText(direction: string | null): string {
  if (direction === 'import') return '已从 Markdown 导入';
  if (direction === 'export') return '已写入 Markdown';
  return '无变化';
}

/** 时刻 → `10:32`（24 小时制：用户看得懂「今天几点」，不需要日期） */
export function clockOf(atMs: number): string {
  const at = new Date(atMs);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** 单档一行字：`已写入 Markdown · 10:32` / `无变化` / `上次同步失败` / `尚未同步` */
export function bindingStatusText(status: MdSyncBindingStatus | undefined): string {
  if (!status) return '尚未同步';
  if (status.lastError) return '上次同步失败';
  if (status.lastSyncAt == null) return '尚未同步';
  return `${directionText(status.lastDirection)} · ${clockOf(status.lastSyncAt)}`;
}

/** 块③那一行聚合状态的形状：一句话 + 最多三行失败原文（PRD 4.3） */
export interface MdSyncAggregate {
  /** `上次同步 10:32 · 已写入 Markdown` / `尚未同步` / `上次同步失败` */
  text: string;
  /** 失败原文（0~3 条；空数组 = 没失败） */
  errors: string[];
}

/**
 * 三档聚合成一行：取 `lastSyncAt` 最大的那一档的 `lastDirection`。
 *
 * 「任一档有 `lastError` → 说失败」排在时间之前：`lastError` 说明**这个落点的文件
 * 现在可能不是最新的**，用一句好看的时间把它盖住就是骗人。
 */
export function aggregateStatus(
  bindings: MdSyncBinding[],
  statuses: MdSyncBindingStatus[],
): MdSyncAggregate {
  const mine: MdSyncBindingStatus[] = [];
  for (const binding of bindings) {
    const found = statuses.find((status) => status.kind === binding.kind);
    if (found) mine.push(found);
  }
  const errors: string[] = [];
  for (const status of mine) if (status.lastError) errors.push(status.lastError);
  if (errors.length > 0) return { text: '上次同步失败', errors: errors.slice(0, 3) };
  let latest: MdSyncBindingStatus | null = null;
  for (const status of mine) {
    if (status.lastSyncAt == null) continue;
    if (latest === null || (status.lastSyncAt ?? 0) > (latest.lastSyncAt ?? 0)) latest = status;
  }
  if (latest === null) return { text: '尚未同步', errors: [] };
  const at = clockOf(latest.lastSyncAt ?? 0);
  return { text: `上次同步 ${at} · ${directionText(latest.lastDirection)}`, errors: [] };
}
