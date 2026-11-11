import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MAIN_TOOLS_TARGET_CHANGED } from "../runtime/insightEvents.ts";

export type MainToolsSection = "pomodoro" | "reminders";

/**
 * 宿主`药丸`（窗口 label = `main`）递过来的一次性落点。
 *
 * `null` = 没有待消费目标。四个分支互斥：
 *  · `tools`    —— V0.12.0 的工具分区跳转（迷你窗 / 标题栏胶囊 / 托盘菜单）；
 *  · `history`  —— P0-03 的历史页某一天（药丸「今天」→ 记录面板 → 本分析窗）；
 *  · `settings` —— [0.12.1] 设置视图（托盘「设置…」/ 药丸手柄 `settings.open`）；
 *  · `overview` —— P1-02 的总览页（摘要面板「在分析窗看总览 ↗」）。
 */
export type MainWindowTarget =
  | { kind: "tools"; section: MainToolsSection }
  | { kind: "history"; dateKey: string; focusApp: string | null }
  | { kind: "settings" }
  | { kind: "overview" };

function isToolsSection(value: unknown): value is MainToolsSection {
  return value === "pomodoro" || value === "reminders";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** 取走待消费目标（`take` 即清空，一次性；重复调用得到 `null`）。 */
export async function takeMainToolsTarget(): Promise<MainWindowTarget | null> {
  const raw = await invoke<unknown>("cmd_take_main_tools_target");
  if (raw === null || raw === undefined) return null;

  const target = asRecord(raw);
  if (!target) throw new Error("Invalid main window target");

  if (isToolsSection(target.tools)) {
    return { kind: "tools", section: target.tools };
  }

  const history = asRecord(target.history);
  const dateKey = history?.dateKey;
  if (typeof dateKey === "string" && dateKey.length > 0) {
    const focusApp = history?.focusApp;
    return {
      kind: "history",
      dateKey,
      focusApp: typeof focusApp === "string" && focusApp.length > 0 ? focusApp : null,
    };
  }

  /* 判序：`tools` → `history` → `settings` → `overview`。Rust 侧四个键互斥
     （`skip_serializing_if`），所以这里只钉「万一并存时行为确定」：history 压 settings、
     settings 压 overview（与 Rust `PatinaOpenTarget::into_view` 逐条同序），
     而 `tools` 仍先判（既有判据 `p003_tools_wins_when_both_keys_are_present` 不许改）。 */
  if (target.settings === true) return { kind: "settings" };

  if (target.overview === true) return { kind: "overview" };

  throw new Error("Invalid main window target");
}

export function onMainToolsTargetChanged(handler: () => void) {
  return listen(MAIN_TOOLS_TARGET_CHANGED, handler);
}
