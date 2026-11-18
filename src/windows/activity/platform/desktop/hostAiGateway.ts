/**
 * 分析窗 → 宿主 AI 桥（[0.12.3]）
 * -----------------------------------------------------------------------------
 * AI 配置归宿主所有（`settings` 的 `ai.config` + DPAPI/Keystore 里的密钥），设置页却
 * 长在分析窗——所以这几个入口必须像 `hostSettingsGateway` 一样直接 `invoke`。
 *
 * 六条命令与宿主 `IpcApi`（`src/windows/timing/types/domain/ipc.ts`）同名同参：
 *   ai_config_get / ai_config_save / ai_test / ai_list_models / ai_suggest_tags / ai_daily_summary
 * 权限见 `src-tauri/permissions/activity-host-settings.toml`。
 *
 * `ai_suggest_tags` 的入参与主窗 `ipc.ts` 一致：`{ request }`（命令侧参数名是 `request`，
 * 不是 `params`）。写错时 Tauri 报的是「missing required key request」，很容易误判成
 * 「后端没注册命令」。
 *
 * 出错口径与隔壁一致：**一律 throw**，message 已是中文人话，调用方显示在卡底。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AiConfig,
  AiConfigView,
  AiDailySummary,
  AiListModelsRequest,
  AiSuggestRequest,
  AiSuggestResponse,
  AiTestResult,
} from "../../shared/types/ai.ts";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error("当前不在桌面宿主里，AI 设置不可用");
  return invoke<T>(command, args);
}

export function aiConfigGet(): Promise<AiConfigView> {
  return call<AiConfigView>("ai_config_get");
}

/** `apiKey` 三态：`undefined` 不改、`""` 清空、其它值写入（与 WebDAV 密码一致）。 */
export function aiConfigSave(config: AiConfig, apiKey?: string | null): Promise<AiConfigView> {
  return call<AiConfigView>("ai_config_save", { config, apiKey: apiKey ?? null });
}

/** 「测试连接」：网络失败也返回 `ok:false`（不 throw），由调用方展示原因。 */
export function aiTest(): Promise<AiTestResult> {
  return call<AiTestResult>("ai_test");
}

/** 只读模型目录（`GET /models`）：不落库、不写密钥，只把 id 列表交给表单。 */
export function aiListModels(request: AiListModelsRequest): Promise<string[]> {
  return call<string[]>("ai_list_models", { request });
}

export function aiSuggestTags(request: AiSuggestRequest): Promise<AiSuggestResponse> {
  return call<AiSuggestResponse>("ai_suggest_tags", { request });
}

export function aiDailySummary(): Promise<AiDailySummary> {
  return call<AiDailySummary>("ai_daily_summary");
}