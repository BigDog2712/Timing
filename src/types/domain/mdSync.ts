/**
 * Timing — Markdown 同步域类型（V0.4.0 起；V0.11.5 从插件贡献点改为**内核功能**）
 * -----------------------------------------------------------------------------
 * 与 `src-tauri/src/models/md_sync.rs` 逐字对应（serde camelCase）。
 * 默认落点由内核给（三个 kind），用户在设置里覆盖；同步执行在 Rust 侧，
 * 前端只负责配置与展示状态——没有「插件装没装」这回事了。
 */

import type { MdSyncCloud, MdSyncCloudChannel } from './mdCloud';

/** 同步的数据种类 */
export type MdSyncKind = 'timers' | 'notes' | 'todos';

/**
 * 各数据种类的展示名（与 Rust 侧 `MdSyncKind::label` 逐字一致）。
 *
 * 集中一份的理由：设置页的落点卡、文件夹选择弹窗、插件页的贡献点摘要都要显示它，
 * 以前三处各写一个三元表达式，加第三种时漏一处就会显示成错的种类名。
 */
export const MD_SYNC_KIND_LABELS: Record<MdSyncKind, string> = {
  timers: '事项计时',
  notes: '便利贴',
  todos: '待办事项',
};

/** 一个落点：根目录 + 相对文件模板 + 目标标题 */
export interface MdSyncBinding {
  kind: MdSyncKind;
  enabled: boolean;
  /** 绝对路径，支持 `%USERPROFILE%` / `~`；空 = 未配置 */
  root: string;
  /** 相对文件模板，支持 `{date}` / `{yyyy}` / `{MM}` / `{dd}` */
  file: string;
  /** 含 # 前缀的标题行，如 `#### 事项计时` */
  heading: string;
}

export interface MdSyncConfig {
  enabled: boolean;
  /**
   * [V0.11.3] 自动同步间隔（秒）。默认 900（15 分钟）。
   * 用户口径：「同步要降，默认十五分钟，可以自己调，也能点手动同步」。
   */
  pollSecs: number;
  bindings: MdSyncBinding[];
  /**
   * [V0.11.13] 云端第二落点（ADR-061）。
   *
   * [V0.11.26] **legacy 只读形**：老配置反序列化入口 + 「测试连接」载荷载体。
   * 桌面产物里后端 `skip_serializing_if` 掉了这个键，读回来运行时是 `undefined`；
   * 类型上**仍写成必填的 `| null`**，因为 `components/mobile` 那两个面板是零 diff 红线，
   * 它们写的是 `config.cloud !== null`（改成 `?` 会让红线文件编译不过）。
   * 「从未配置」的两种线上形状（缺键 / null）在判据里等价：`?? emptyCloud()` 兜住前者。
   *
   * 新保存形里这个键**必须不出现**（O11）；「测试连接」按被测通路现拼一份
   * （`mdSyncConfig::legacyCloudForTest`），因为 `probe.rs` 只认带 `mode` 的旧结构。
   */
  cloud: MdSyncCloud | null;
  /**
   * [V0.11.26] 块④ 本地同步通路（后端 `cloudFolder`）。`undefined` / `null` = 从未配置。
   *
   * 两条通路**各持一份**，互不镜像：改块④ 的落点目录不许动到块⑤ 的三件套（O13）。
   */
  cloudFolder?: MdSyncCloudChannel | null;
  /** [V0.11.26] 块⑤ 云端同步通路（后端 `cloudWebdav`）。 */
  cloudWebdav?: MdSyncCloudChannel | null;
}

/** 单个落点的运行状态 */
export interface MdSyncBindingStatus {
  kind: MdSyncKind;
  /** 今天解析后的绝对路径；未配置为空串 */
  path: string;
  exists: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
  /** `export`（SQL → MD）/ `import`（MD → SQL）/ `none` */
  lastDirection: string | null;
}

export interface MdSyncStatus {
  lastSyncAt: number | null;
  lastError: string | null;
  bindings: MdSyncBindingStatus[];
}

/** `md_sync_get` / `md_sync_save` 的返回 */
export interface MdSyncView {
  /** 本地今天，`YYYY-MM-DD`，用于路径预览 */
  today: string;
  config: MdSyncConfig;
  status: MdSyncStatus;
}

/** 一次同步的结果；也是 `md-sync:changed` 的事件载荷 */
export interface MdSyncReport {
  at: number;
  /** 写文件的落点数 */
  exported: number;
  /** 从 Markdown 改到 SQL 的记录 / 便利贴条数 */
  imported: number;
  kinds: MdSyncKind[];
  errors: string[];
}

/** 事件载荷别名（语义更清楚） */
export type MdSyncChangedPayload = MdSyncReport;
