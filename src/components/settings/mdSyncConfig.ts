/**
 * Timing — 设置 · 同步 · 配置小口径（V0.11.13）
 * -----------------------------------------------------------------------------
 * 从 `MdSyncTab` / `useMdSyncDraft` 里抽出来的**唯一一份**数字与字符串口径：间隔上下限、
 * 分钟↔秒换算、云端通道空配置。
 * [V0.11.15] 再加三类纯函数：模板展开（`previewFile` / `subDirOf`）、后端校验原文的
 * 就地定位（`splitBindingError`）、字节格式化（`formatBytes`）。它们都只做「把一份输入
 * 变成另一份字符串」，同样不读 state、不碰网络。
 *
 * 为什么不各写一份：保存按一处算、「测试连接」按另一处算，很快就出现「测试通过、保存后
 * 不生效」这类没人能复现的故障。本文件是纯函数，不读 state、不碰网络。
 */
import type { MdSyncBinding, MdSyncBindingStatus, MdSyncCloud } from '../../types/domain';

/** 间隔上下限（分钟）：与后端 `MD_SYNC_POLL_MIN_SECS / MAX_SECS` 同值 */
export const POLL_MIN_MINUTES = 1;
export const POLL_MAX_MINUTES = 1440;
export const POLL_DEFAULT_MINUTES = 15;

/** 秒 → 分钟（配置存秒，界面按分钟说人话） */
export function toMinutes(secs: number): number {
  return Math.max(POLL_MIN_MINUTES, Math.round(secs / 60));
}

/** 分钟输入归一：越界夹到边界，非数字回默认（不让用户卡在一个非法值上） */
export function clampMinutes(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return POLL_DEFAULT_MINUTES;
  return Math.min(POLL_MAX_MINUTES, Math.max(POLL_MIN_MINUTES, parsed));
}

/** 分钟文本 → 落库口径（秒）：保存与「测试连接」共用这一处 */
export function pollSecsOf(raw: string): number {
  return clampMinutes(raw) * 60;
}

/** 间隔文案：整点补一句「（2 小时）」，用户不必自己心算 */
export function describeInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${minutes} 分钟（${hours} 小时）` : `${minutes} 分钟`;
}

/* 云端通道空配置：`enabled` 必须是 `false`——视图没加载时凭空给 `true`，用户下一次
   保存就会把云端通道偷偷打开。
   [V0.11.18] `enabled` 的语义已升格为**存储通道**（`true` = 本地 + 云端，`false` = 只用
   本地），所以 `false` 这条默认值现在有第二个理由：从没配过云端的人默认「只用本地」，
   与 PRD A1 的默认态一致。（旧理由仍成立：凭空 `true` 仍会在下一次保存时打开云端。）
   [V0.11.16] 三个默认值（PRD R7 / 裁决 Q1 / QA F1 回修）：`mode` + 服务地址 + 远端目录
   **直接写进值**（不是 placeholder），最常见的那台服务器开箱可用。
   `mode: 'webdav'` 是 F1 修的：v0.11.16 首版留 `localfolder`，于是「服务地址自动默认
   填写」这条要做到得先手动切一次分段——预填值存在但不在用户眼前，等于没做到。
   **只在 `cloud === null`（从未配置过）时生效**——已有配置一律原样回填，绝不被默认值
   覆盖（PRD 6.1 的硬口径，E2 仍然成立）。
   `%` 一律不出现：中文路径存中文、显示中文，编码交给 `url` crate 在发请求时做一次。
   [V0.11.17] B3：`basePath` 从 `/我的坚果云/Timing` 改成 `/Timing`——坚果云的 `dav` 根
   就是「我的坚果云」，`/Timing` 是它下面那一级；少一级中文目录，真机少一次编码/权限
   歧义。配套提示见 `mdSyncCopy.ts::CLOUD_DIR_HINT`（首次使用到网页版新建这个文件夹）。 */
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
 * [V0.11.18] 存储通道（PRD 三 / CH1–CH4）：页签顶部那个二选一。
 *
 * `local` = 只跑 Markdown 同步（写本地 md 文件）；`both` = Markdown 同步 + 云端通道。
 * 它**不是**「数据搬进云端、本地不落」——SQLite 永远在本机（PRD §10-N6）。
 */
export type MdSyncChannel = 'local' | 'both';

/**
 * 通道的**唯一**判据。整个前端不许出现第二份 `cloud.enabled ? .. : ..`。
 *
 * 真相在 `MdSyncCloud.enabled`（`models/md_sync_cloud.rs:64-65`）：`true` = 本地 + 云端，
 * `false` = 只用本地。老配置 `enabled: true` 直接推出「本地 + 云端」，**读的时候不改盘**，
 * 所以不需要迁移脚本（选候选 A「新增字段」就必须写迁移，已在设计 §2.2 否决）。
 *
 * `draft.cloud` 永远非 null（`useMdSyncDraft` 回填时 `?? emptyCloud()`），本函数因此
 * 不接受 null：让类型把这条不变量说出来，比在函数体里判 null 更早挡住误用。
 */
export function channelOf(cloud: MdSyncCloud): MdSyncChannel {
  return cloud.enabled ? 'both' : 'local';
}

/**
 * 反向：分段控件点击 → 要写进草稿的那份 cloud。**只动 `enabled`**，其余字段原样保留。
 *
 * CH4「云端配置已保留，切回即恢复」就是靠这一行成立的：切到「只用本地」不碰地址 /
 * 远端目录 / 账号，密文本来也不在这里（在 keychain）。
 */
export function withChannel(cloud: MdSyncCloud, next: MdSyncChannel): MdSyncCloud {
  return { ...cloud, enabled: next === 'both' };
}

/**
 * 保存前归一：**从没配过**（`wasConfigured === false`）且用户最终停在「只用本地」→ 落
 * `null`，让这类用户的库与 v0.11.17 完全 diff 为零；配过的人一概不归一（CH4）。
 *
 * 不这么做的后果很具体：从没配过云端的人点一下「本地 + 云端」再点回「只用本地」保存，
 * 落库会从 `cloud: null` 变成 `{enabled:false, mode:'webdav', baseUrl:'https://dav.jianguoyun.com/dav/', …}`
 * ——库里多出一个「像是配过」的对象，`cloudConfigured` 随之变 `true`，块④ 从此默认展开。
 *
 * `wasConfigured` 取**保存动作那一刻的视图值**（`view.config.cloud != null`），不是草稿：
 * 草稿里的 cloud 永远非 null，判不出「从没配过」。
 */
export function cloudToSave(cloud: MdSyncCloud, wasConfigured: boolean): MdSyncCloud | null {
  if (wasConfigured || cloud.enabled) return cloud;
  return null;
}

/**
 * 云端通道是否「开了且填全了」——[V0.11.18] A6 那句 `云端还没填全，暂时不会同步。` 的判据。
 *
 * **与后端 `services/md_cloud/mod.rs::usable` + `models/md_sync_cloud.rs::is_usable` 同口径，
 * 改一边必须改另一边。** 逐条对齐（不要凭印象重写）：
 *
 * 1. `enabled` 为假 → 不可用（后端 `usable` 先 `.filter(|c| c.enabled && …)`，
 *    `is_usable` 自己再判一次 `enabled`）；
 * 2. `mode === 'localfolder'` → 只看 `localRoot` 非空白（**不看地址 / 账号**，
 *    那条路一次网络请求都不发）；
 * 3. `mode === 'webdav'` → `baseUrl` / `basePath` / `user` **三个都要**非空白。
 *    密码**不参与**：它不在 `MdSyncCloud` 里（密文归 `infra::secret`），后端这一判也不看它
 *    ——「有账号没密码」在界面上仍算「填全」，真正的失败由「测试连接」/ `lastError` 说。
 *
 * 三处都用 `.trim()` 判空白串，与后端的 `.trim().is_empty()` 一致：
 * 用户敲一个空格不等于填了。
 *
 * 为什么要在前端再写一份（后端已经有 `is_usable`）：前端拿不到 `is_usable`——视图只回
 * `MdSyncCloudStatus`（`enabled / mode / hasSecret / todayPushed / pendingDates / lastError`），
 * **没有字段本身**。新增一个命令或给状态加字段等于改契约 78，本轮不允许，所以在前端纯函数里
 * 对齐一份，并靠 `mdSyncConfig.test.ts` 的四档用例钉住。
 */
export function isCloudReady(cloud: MdSyncCloud): boolean {
  if (!cloud.enabled) return false;
  if (cloud.mode === 'localfolder') return cloud.localRoot.trim() !== '';
  return cloud.baseUrl.trim() !== '' && cloud.basePath.trim() !== '' && cloud.user.trim() !== '';
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
