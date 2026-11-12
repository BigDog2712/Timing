/**
 * 宿主 API 的**同形状门面**（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 目的只有一个：让从 `src/components/settings/**` 搬过来的文件**只改 import 路径**，
 * 逻辑一行不动。原来它们 import 的是 `services/api`（`mdSyncApi` / `mdBackupApi` /
 * `dataRootApi` / `pluginApi` / `settingsApi`）与 `services/ipc`（`errorText` /
 * `rawIpcText`）——那些都在主窗侧，L9 禁止分析窗 import。
 *
 * 这里按**同名对象、同名方法、同名参数**把它们重导出到 `src/platform/desktop/host*Gateway`
 * 上。搬迁时唯一要改的是 `from '../../services/api'` → `from './hostApi'`（路径按深度）。
 *
 * 两条口径差异，写在这里免得下一个人踩：
 *  1. `errorText` / `rawIpcText` 不再走「错误码 → 中文」的 15 条映射表：宿主的 `AppError`
 *     序列化时**已经带中文 `message`**（`src-tauri/src/error.rs:201`），gateway 把 message
 *     原样抛出。码表留在宿主侧一处，本文件只做「取 message，取不到给兜底」。
 *  2. 浏览器 / 单测环境没有 Tauri 注入对象，gateway 会抛「不在桌面宿主里」——比让
 *     `invoke` 抛内部错误更像人话。
 */
import {
  accentGet,
  accentSet,
  getAutostart,
  getReferenceSettings,
  getSettings,
  setAutostart,
  themeGet,
  themeSet,
  updateReferenceSettings,
  updateSettings,
  type HostReferenceSettings,
} from "../../../platform/desktop/hostSettingsGateway";
import {
  dataRootChange,
  dataRootGet,
  dataRootOpen,
  dailyStatusGet,
  dailyStatusSet,
  getMigrationInfo,
  mdBackupExport,
  mdBackupList,
  mdBackupOpen,
  mdBackupRestore,
  mdSyncGet,
  mdSyncOpen,
  mdSyncRun,
  mdSyncSave,
  mdSyncTest,
  mdSafPick,
  mdSafStatus,
  openLegacyDir,
} from "../../../platform/desktop/hostSyncGateway";
import { pluginList, pluginOpenDir } from "../../../platform/desktop/hostPluginsGateway";
import type {
  HostSettings,
  MdSyncConfig,
  MdSyncKind,
} from "./host/hostTypes";

/** 设置域：与宿主 `settingsApi` 方法名逐个对齐。 */
export const settingsApi = {
  get: (): Promise<HostSettings> => getSettings() as Promise<HostSettings>,
  update: (patch: Record<string, unknown>): Promise<HostSettings> =>
    updateSettings(patch) as Promise<HostSettings>,
  getReference: (): Promise<HostReferenceSettings> => getReferenceSettings(),
  updateReference: (patch: Record<string, unknown>): Promise<HostReferenceSettings> =>
    updateReferenceSettings(patch),
  getAutostart: (): Promise<boolean> => getAutostart(),
  setAutostart: (enabled: boolean): Promise<boolean> => setAutostart(enabled),
  themeGet,
  themeSet,
  accentGet,
  accentSet,
};

/** 插件域。 */
export const pluginApi = {
  list: pluginList,
  openDir: pluginOpenDir,
};

/** Markdown 同步域（执行在 Rust，前端只配置与看状态）。 */
export const mdSyncApi = {
  get: mdSyncGet,
  save: (config: MdSyncConfig, secret?: string | null) => mdSyncSave(config, secret),
  run: mdSyncRun,
  open: (kind: MdSyncKind): Promise<void> => mdSyncOpen(kind),
  test: (config: MdSyncConfig, secret?: string | null) => mdSyncTest(config, secret),
};

/** 备份域。`export` 是合法属性名（手机端「保存到…」用，桌面不挂）。 */
export const mdBackupApi = {
  list: mdBackupList,
  restore: (name: string, target?: string | null) => mdBackupRestore(name, target),
  open: (name: string): Promise<void> => mdBackupOpen(name),
  export: (name: string) => mdBackupExport(name),
};

/** 数据根域（`change()` 不传参 = 撤销待生效的切换）。 */
export const dataRootApi = {
  get: dataRootGet,
  change: (path?: string | null) => dataRootChange(path),
  open: (): Promise<void> => dataRootOpen(),
};

/** 旧版迁移信息 + SAF 目录（桌面只有前者有内容，后者为签名完整保留）。 */
export const migrationApi = {
  info: getMigrationInfo,
  openLegacyDir,
  safPick: mdSafPick,
  safStatus: mdSafStatus,
};

/** 每日待办状态。 */
export const dailyStatusApi = {
  get: dailyStatusGet,
  set: dailyStatusSet,
};

/** 给用户看的一句话：宿主的 `AppError.message` 本来就是中文，取不到才兜底。 */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  if (typeof err === "string" && err.trim().length > 0) return err;
  return "操作失败，请重试";
}

/** 原文透出（预检拒绝理由这类「用户唯一行动依据」不许被润色）。与 `errorText` 同源。 */
export const rawIpcText = errorText;
