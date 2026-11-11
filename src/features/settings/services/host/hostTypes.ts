/**
 * 分析窗侧的 DTO 形状镜像（[0.12.1] T04b：设置搬进主界面）
 * -----------------------------------------------------------------------------
 * 为什么要复制一份：这些形状的权威定义在 `src/types/domain/**`，但那个目录属**主窗**，
 * L9 双窗隔离禁止 `src/features/**` import 它（连 `import type` 也算）。
 * 先例是 `src/shared/theme/hostAccentBridge.ts`：它把宿主的四色形状镜像过来，并在注释里
 * 写死「改一处两处同改」——本文件同一口径。
 *
 * 与 Rust 的对应关系没有变：`src-tauri/src/models/md_sync*.rs` / `plugin.rs` / `data_root.rs`
 * 仍是唯一真相；本文件只是把**同一份 serde 形状**用 TS 再声明一次。字段名与可空性必须
 * 与 `src/types/domain/` 逐字一致，否则症状是「保存成功但回读缺字段」这类零日志问题。
 *
 * 校验：`grep -rn "from [\"'].*types/domain" src/features/` 必须 0 命中（本文件是唯一豁免，
 * 它不 import 任何东西）。
 */

/* ---- Markdown 同步（models/md_sync.rs） ---- */
export type MdSyncKind = 'timers' | 'notes' | 'todos';

export const MD_SYNC_KIND_LABELS: Record<MdSyncKind, string> = {
  timers: '事项计时',
  notes: '便利贴',
  todos: '待办事项',
};

export interface MdSyncBinding {
  kind: MdSyncKind;
  enabled: boolean;
  root: string;
  file: string;
  heading: string;
}

export interface MdSyncConfig {
  enabled: boolean;
  pollSecs: number;
  bindings: MdSyncBinding[];
  cloud: MdSyncCloud | null;
  cloudFolder?: MdSyncCloudChannel | null;
  cloudWebdav?: MdSyncCloudChannel | null;
  diaryTemplate?: string;
}

export interface MdSyncBindingStatus {
  kind: MdSyncKind;
  path: string;
  exists: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
  lastDirection: string | null;
}

export interface MdSyncStatus {
  lastSyncAt: number | null;
  lastError: string | null;
  bindings: MdSyncBindingStatus[];
}

export interface MdSyncView {
  today: string;
  config: MdSyncConfig;
  status: MdSyncStatus;
}

export interface MdSyncReport {
  at: number;
  exported: number;
  imported: number;
  kinds: MdSyncKind[];
  errors: string[];
}

/* ---- 云端第二落点（models/md_sync_cloud.rs） ---- */
export type CloudMode = 'localfolder' | 'webdav';
export type CloudSchedule = 'off' | 'interval' | 'smart';

export interface MdSyncCloudAuto {
  schedule: CloudSchedule;
  intervalMinutes: number;
}

export interface MdCloudPurgeStatus {
  paused: boolean;
  deleted: number;
  failed: number;
}

export interface MdSyncCloud {
  enabled: boolean;
  mode: CloudMode;
  localRoot: string;
  baseUrl: string;
  basePath: string;
  user: string;
  auto?: MdSyncCloudAuto;
}

export interface MdSyncCloudChannel {
  enabled: boolean;
  localRoot?: string;
  baseUrl?: string;
  basePath?: string;
  user?: string;
  auto?: MdSyncCloudAuto;
}

export interface MdSyncCloudStatus {
  enabled: boolean;
  mode: CloudMode;
  hasSecret: boolean;
  todayPushed: boolean;
  pendingDates: string[];
  lastError: string | null;
  purge?: MdCloudPurgeStatus;
}

/** `md_sync_get` / `md_sync_save` 的返回：基础视图 + 两块状态（后端 `flatten`）。 */
export type MdSyncViewCloud = MdSyncView & {
  cloud: MdSyncCloudStatus;
  local?: MdSyncCloudStatus;
};

export type MdSyncTestStepKey = 'account' | 'dir' | 'write';

export interface MdSyncTestStep {
  key: MdSyncTestStepKey;
  ok: boolean;
  detail: string | null;
}

export interface MdSyncTestResult {
  ok: boolean;
  detail: string;
  steps?: MdSyncTestStep[];
}

/* ---- 备份（同一份 models/md_sync_cloud.rs） ---- */
export interface MdBackupItem {
  name: string;
  target: 'obsidian' | 'webdav' | 'folder' | null;
  source: string;
  date: string | null;
  atMs: number;
  bytes: number;
}

export interface MdBackupRestoreResult {
  date: string;
  target: string | null;
  imported: number;
  written: number;
}

export interface MdBackupExport {
  saved: boolean;
  fileName: string;
}

/* ---- 数据根（models/data_root.rs） ---- */
export interface DataRootEntry {
  name: string;
  isDir: boolean;
  present: boolean;
  bytes: number;
}

export interface DataRootInfo {
  current: string;
  defaultPath: string;
  isDefault: boolean;
  writable: boolean;
  writableError: string | null;
  pending: string | null;
  previous: string | null;
  sizeBytes: number;
  entries: DataRootEntry[];
  affected: string[];
  pluginsInDataRoot: boolean;
}

/* ---- 插件（models/plugin.rs） ---- */
export type PluginSource = 'dev' | 'exe' | 'user';

export interface QuickTimer {
  item: string;
  minutes: number;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  source: PluginSource;
  dir: string;
  enabled: boolean;
  error: string | null;
  quickTimers: QuickTimer[];
  warnings: string[];
}

export interface PluginListResult {
  dir: string;
  plugins: PluginInfo[];
  quickTimers: QuickTimer[];
}

/* ---- 宿主设置（只取本批用到的字段；其余字段原样透传） ---- */
export interface HostSettings {
  autostartEnabled: boolean;
  [key: string]: unknown;
}

export interface HostReferenceSettings {
  highlightColor: string;
  minRecordSeconds: number;
  [key: string]: unknown;
}

/** 手机端 SAF 目录状态（`md_saf_*`）。桌面不挂这两个面，类型只为网关签名完整。 */
export interface SafStatus {
  granted: boolean;
  label: string;
}
