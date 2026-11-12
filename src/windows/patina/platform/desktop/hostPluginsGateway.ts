/**
 * Patina（分析窗）→ 宿主插件目录（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 只有两条命令，单独成文件是为了不让 `hostSettingsGateway.ts`（120 行贴线）继续长——
 * 插件是「磁盘事实」，与设置/同步是三个域，调用点也各不相同。
 *
 * 宿主端口：`plugin_list` / `plugin_open_dir`（`capabilities/patina.json` 的
 * `patina-host-settings` 授予）。返回形状见 `hostTypes.ts::PluginListResult`。
 */
import { invoke } from "@tauri-apps/api/core";
import type { PluginListResult } from "../../../shared/dto/hostTypes";

export type { PluginInfo, PluginListResult, PluginSource, QuickTimer } from
  "../../../shared/dto/hostTypes";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(command: string): Promise<T> {
  if (!isTauriRuntime()) throw new Error("当前不在桌面宿主里，插件目录不可读");
  try {
    return await invoke<T>(command);
  } catch (raw) {
    const message = typeof raw === "object" && raw !== null && typeof (raw as { message?: unknown }).message === "string"
      ? (raw as { message: string }).message
      : "插件目录读取失败";
    /* `cause` 必须带上：`preserve-caught-error` 要的就是原始 payload（排查「为什么目录读不到」
       时要能看到宿主的 code，而不是只剩一句人话）。 */
    throw new Error(message, { cause: raw });
  }
}

/** 读插件目录与插件清单（含载入失败的那些，失败原因原样带出）。 */
export function pluginList(): Promise<PluginListResult> {
  return call<PluginListResult>("plugin_list");
}

/** 在资源管理器里打开用户插件目录。 */
export function pluginOpenDir(): Promise<void> {
  return call<void>("plugin_open_dir");
}
