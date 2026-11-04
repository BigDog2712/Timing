/**
 * TickBar — Markdown 同步域类型（V0.4.0 / 插件 API v2）
 * -----------------------------------------------------------------------------
 * 与 `src-tauri/src/models/md_sync.rs` 逐字对应（serde camelCase）。
 * 插件只声明落点；同步执行在 Rust 侧，前端只负责配置与展示状态。
 */

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
  bindings: MdSyncBinding[];
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
  installed: boolean;
  pluginId: string | null;
  pluginName: string | null;
  pluginVersion: string | null;
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

/** 插件启动头里的 mdSync 贡献 */
export interface MdSyncContribution {
  bindings: MdSyncBinding[];
}

/** 事件载荷别名（语义更清楚） */
export type MdSyncChangedPayload = MdSyncReport;
