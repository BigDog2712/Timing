/**
 * Patina（分析窗）→ 宿主 Timing 的**设置写面**（[0.12.1] T04：设置搬进主界面）
 * -----------------------------------------------------------------------------
 * 设置页从独立设置窗搬进主界面（分析窗）之后，主题 / 四色 / 参考设置这些**归宿主所有**的
 * 数据必须有一个从分析窗出得去的通道。分析窗读不到 `src/services/**`（L9 双窗隔离），
 * 所以这里直接用 `invoke` 封装，函数名与宿主 `IpcApi`（`src/types/domain/ipc.ts`）逐字对齐。
 *
 * 与 `platform/runtime/hostThemeGateway.ts` 的分工：那个是**只读**桥（启动时读一次 +
 * 订阅 `theme-changed`）；本文件是**写面 + 设置面**，权限见
 * `src-tauri/permissions/patina-host-settings.toml`。按域拆的三份：本文件（主题/设置）、
 * `hostSyncGateway.ts`（md_sync / 备份 / 数据根）、`hostPluginsGateway.ts`（插件）。
 *
 * 出错口径：**一律 throw**（消息已是人话），调用方捕获后显示在卡底——安静的失败会让用户
 * 以为「点了没反应」，那正是本批要消灭的症状。
 */
import { invoke } from "@tauri-apps/api/core";
import type { ThemeMode } from "../../shared/settings/appSettings.ts";

/** 四色键（与宿主 `AccentKey` 同名，4 个）。 */
export type HostAccentKey = "running" | "warn" | "done" | "bar";

/** 宿主四色；`bar === null` = 跟随主题令牌（与后端 `AccentColors` 逐字一致）。 */
export interface HostAccents {
  running: string;
  warn: string;
  done: string;
  bar: string | null;
}

/** 出厂四色。**与 `src/lib/theme.ts::DEFAULT_ACCENTS` 及 Rust `models::constants` 同值**：
    复制而非 import（那个文件属主窗，L9 禁跨窗 import），改一处必须三处同改。 */
export const DEFAULT_HOST_ACCENTS: HostAccents = {
  running: "#4DA3E8",
  warn: "#E8A33D",
  done: "#4CC38A",
  bar: null,
};

/** 宿主 settings 表快照。本批只透传，字段类型留到落界面时再收窄（T04b）。 */
export type HostSettingsSnapshot = Record<string, unknown>;
/** 宿主参考设置（本批消费 `highlightColor` / `minRecordSeconds`，其余原样透传；camelCase）。 */
export type HostReferenceSettings = {
  highlightColor: string;
  minRecordSeconds: number;
  [key: string]: unknown;
};

/** 参考设置的部分更新（与 Rust `ReferenceSettingsPatch` 对齐） */
export type HostReferencePatch = Partial<HostReferenceSettings>;


const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 统一入口：浏览器（单测 / vite 单跑）直接抛人话，别让 `invoke` 抛内部错误 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error("当前不在桌面宿主里，这条设置命令不可用");
  return invoke<T>(command, args);
}

/** 四色载荷校验：三个主色必须是字符串，`bar` 可空。形状不对就抛（不猜）。 */
function asAccents(raw: unknown): HostAccents {
  const value = (raw ?? {}) as Record<string, unknown>;
  const { running, warn, done } = value;
  if (typeof running !== "string" || typeof warn !== "string" || typeof done !== "string") {
    throw new Error("宿主返回的四色格式不对");
  }
  return { running, warn, done, bar: typeof value.bar === "string" ? value.bar : null };
}

/** 读主题模式（`{ mode }` → `mode`；缺字段时退到 `system`，不当作错误）。 */
export async function themeGet(): Promise<ThemeMode> {
  const raw = await call<{ mode?: ThemeMode }>("theme_get");
  return raw?.mode ?? "system";
}

/** 写主题模式；宿主同批广播 `theme-changed`（K-21，各窗自订阅）。 */
export async function themeSet(mode: ThemeMode): Promise<ThemeMode> {
  const raw = await call<{ mode?: ThemeMode }>("theme_set", { mode });
  return raw?.mode ?? mode;
}

export async function accentGet(): Promise<HostAccents> {
  return asAccents(await call<unknown>("accent_get"));
}

/** 部分更新四色（`bar: null` = 重置为「跟随主题」）。 */
export async function accentSet(patch: Partial<HostAccents>): Promise<HostAccents> {
  return asAccents(await call<unknown>("accent_set", { patch }));
}

export function getSettings(): Promise<HostSettingsSnapshot> {
  return call<HostSettingsSnapshot>("get_settings");
}
export function updateSettings(patch: HostSettingsSnapshot): Promise<HostSettingsSnapshot> {
  return call<HostSettingsSnapshot>("update_settings", { patch });
}

export function getAutostart(): Promise<boolean> {
  return call<boolean>("get_autostart");
}
export function setAutostart(enabled: boolean): Promise<boolean> {
  return call<boolean>("set_autostart", { enabled });
}
export function getReferenceSettings(): Promise<HostReferenceSettings> {
  return call<HostReferenceSettings>("get_reference_settings");
}

export function updateReferenceSettings(patch: HostReferencePatch): Promise<HostReferenceSettings> {
  return call<HostReferenceSettings>("update_reference_settings", { patch });
}
