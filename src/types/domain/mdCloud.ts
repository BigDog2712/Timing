/**
 * Timing — 云端第二落点类型（V0.11.13，ADR-061）
 * -----------------------------------------------------------------------------
 * 与 `src-tauri/src/models/md_sync_cloud.rs` 逐字对应。**两个 serde 口径不同**，都必须钉住：
 *
 * - `CloudMode` 在 Rust 侧是 `rename_all = "lowercase"` → 线上值是 `'localfolder'` /
 *   `'webdav'`（全小写，不是 `'localFolder'`）。写错不会编译报错，只会在保存回读时
 *   拿到 serde 的 `unknown variant`，用户看到的是「保存不了」。
 * - `MdSyncCloud` / `MdSyncCloudStatus` 是 `camelCase` → `localRoot` / `baseUrl` / …。
 *
 * `MdSyncViewCloud` 用交叉类型表达 `#[serde(flatten)]`：后端把云端状态**平铺**在基础
 * 视图旁边（不是嵌套成 `{ base: {...}, cloud: {...} }`），所以线上的形状就是
 * `{ today, config, status, cloud }`。
 *
 * 密码**不在这里**：视图只给 `hasSecret: boolean`，明文永远不出后端。
 */

import type { MdSyncView } from './mdSync';

/** 云端通道的两种部署方式（线缆值全小写，见上方说明） */
export type CloudMode = 'localfolder' | 'webdav';

/** [V0.11.19 批 1] 云端自动同步三档（后端 `CloudSchedule` 的 lowercase 线缆值）。 */
export type CloudSchedule = 'off' | 'interval' | 'smart';

/**
 * [V0.11.19 批 1] 三档配置。**两个字段必须分开**（PRD §15.2.1 H-2）：
 * 切档只改 `schedule`，`intervalMinutes` 原样带过，否则「定时 30 → 智能 → 定时」
 * 会把用户填的 30 盖回 15。
 */
export interface MdSyncCloudAuto {
  schedule: CloudSchedule;
  intervalMinutes: number;
}

/** [V0.11.19 变更 A] 块④ 状态区那一行只读文字的数据来源（T04 接后端）。 */
export interface MdCloudPurgeStatus {
  paused: boolean;
  deleted: number;
  failed: number;
}

/** 云端通道配置（`MdSyncConfig.cloud`；老配置没有这个字段 → 运行时是 `null`）
 *
 * [V0.11.26] **legacy 只读形 / 测试连接载荷**：新保存形里 `cloud` 键不再出现
 * （两条通路各一份 `MdSyncCloudChannel`）。这个结构还活着的原因只有两个：
 * ① 老 JSON 的反序列化入口；② 「测试连接」的载荷载体——后端 `probe.rs` 是红线文件，
 * 它只认这一份带 `mode` 的形状，所以前端按被测通路现拼一份（`legacyCloudForTest`）。
 */
export interface MdSyncCloud {
  enabled: boolean;
  mode: CloudMode;
  /** `localfolder`：坚果云同步文件夹或任意本地目录（绝对路径） */
  localRoot: string;
  /** `webdav`：服务地址，如 `https://dav.jianguoyun.com/dav/` */
  baseUrl: string;
  /** `webdav`：远端目录，如 `/Timing/md` */
  basePath: string;
  /** `webdav`：账号（坚果云要的是「应用密码」对应的账号） */
  user: string;
  /**
   * [V0.11.19] 可选：老后端 / 老配置 / 老 mock 没有这个键时前端按「智能 + 15」显示，
   * **只在用户动过档位时写回**，避免把「没有」写成「默认」而破坏老配置逐字节不变。
   */
  auto?: MdSyncCloudAuto;
}

/**
 * [V0.11.26] 一条通路自己的配置（后端 `MdSyncCloudChannel`，camelCase）。
 *
 * 它是旧 `MdSyncCloud` 的**去 mode 超集**：没有 `mode`——块④ 就是本地、块⑤ 就是 WebDAV，
 * 「这条通路是哪种载体」由它在页签里的位置决定（PRD R6 / §4.2）。
 *
 * 四个字符串字段在后端都是 `#[serde(default)] String`（永远序列化出来，可能是 `""`），
 * 这里标可选只是为了构造方便；判「填没填全」一律走 `isLocalReady / isWebdavReady`。
 */
export interface MdSyncCloudChannel {
  enabled: boolean;
  /** folder 通路：落点目录（绝对路径） */
  localRoot?: string;
  /** webdav 通路：服务地址 */
  baseUrl?: string;
  /** webdav 通路：远端目录 */
  basePath?: string;
  /** webdav 通路：账号 */
  user?: string;
  /** 该通路自己的三档（`undefined` = 老配置，读作默认「智能 + 15 分钟」） */
  auto?: MdSyncCloudAuto;
}

/** 云端通道的运行时状态（设置页原样展示，不臆造「成功」） */
export interface MdSyncCloudStatus {
  enabled: boolean;
  mode: CloudMode;
  /** 密文是否已存（**不是**密码本身） */
  hasSecret: boolean;
  /** 今天那份是否已成功上传 */
  todayPushed: boolean;
  /** 待上传的日期（升序，`YYYY-MM-DD`） */
  pendingDates: string[];
  lastError: string | null;
  /** [V0.11.19 变更 A] 往期清理状态；可选，老后端不回这个字段时界面按常态句显示。 */
  purge?: MdCloudPurgeStatus;
}

/**
 * `md_sync_get` / `md_sync_save` 的返回：基础视图 + 两块状态（后端 `flatten`）。
 *
 * [V0.11.26] `+local`：块④ 本地同步自己的状态（`view.local`），块⑤ 读 `view.cloud`。
 * 两块互不共用一行数字——串了就是「本地写过了 → 云端显示今天已上传」。
 *
 * `local` 是**可选**的，只有一条理由：手机端不挂载块④（`MdSyncTab` 里 `!IS_MOBILE`），
 * 而 `components/mobile` 是零 diff 红线（O19）——那里的视图夹具不会带这个键，把类型写成
 * 必填会让红线文件编译不过。桌面产物里后端（`services/md_cloud/state.rs::view()`）
 * **恒投这一份**，所以 `MdSyncLocalCard` 读到的永远是真的状态，`?? null` 只是兜底。
 */
export type MdSyncViewCloud = MdSyncView & {
  cloud: MdSyncCloudStatus;
  local?: MdSyncCloudStatus;
};

/**
 * 「测试连接」的三个关卡标识。**这是契约**（后端 `MdSyncTestStep.key` 的字面量），
 * 中文标签在前端（`STEP_LABELS`）：改标签不必动 Rust，改这里的字符串就等于破契约。
 */
export type MdSyncTestStepKey = 'account' | 'dir' | 'write';

/** 一关的结论（[V0.11.16] 三关分诊，PRD R8） */
export interface MdSyncTestStep {
  key: MdSyncTestStepKey;
  ok: boolean;
  /** 这一关失败时的一句人话；`null` = 通过 */
  detail: string | null;
}

/** 测试连接的结果；`ok = false` 时 `detail` 是给人看的一句话，不是 `HTTP 403` */
export interface MdSyncTestResult {
  ok: boolean;
  detail: string;
  /**
   * 只含**已经走过**的关（失败即停）。**可选**：浏览器 mock 与更老的后端没有这个字段，
   * 前端据 `steps` 缺失退回「只显示 `detail`」那条渲染路径。
   */
  steps?: MdSyncTestStep[];
}

/** 备份列表的一项（事实全部读自备份文件名） */
export interface MdBackupItem {
  /** 文件名，恢复时原样回传 */
  name: string;
  /** 归属；`null` = 老备份（无 `__` 前缀，列表标「归属未知」） */
  target: 'obsidian' | 'webdav' | 'folder' | null;
  /** 来源文件名，如 `2026-11-06.md` */
  source: string;
  /** 从名字推出来的日期；推不出 → `null`（恢复时要用户指定目标） */
  date: string | null;
  atMs: number;
  bytes: number;
}

/** 恢复的结果（前端据此拼一句「已恢复 …」） */
export interface MdBackupRestoreResult {
  date: string;
  target: string | null;
  /** 导入回 SQL 的记录 / 便利贴条数 */
  imported: number;
  /** 写回的文件数（三个种类常落同一个文件，通常是 1） */
  written: number;
}

/** [V0.11.23] 导出一份备份的结果（手机专属：系统「保存到…」） */
export interface MdBackupExport {
  /** `true` = 已写进用户挑的位置；`false` = 用户在选择器里取消了（**不是失败**） */
  saved: boolean;
  /** 实际建议的文件名（去掉落点前缀后的那份） */
  name: string;
}
