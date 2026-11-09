import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MAIN_TOOLS_TARGET_CHANGED } from "../runtime/insightEvents.ts";

export async function takeMainToolsTarget(): Promise<"pomodoro" | "reminders" | null> {
  const target = await invoke<unknown>("cmd_take_main_tools_target");
  if (target === null || target === "pomodoro" || target === "reminders") return target;
  throw new Error("Invalid main tools target");
}

export function onMainToolsTargetChanged(handler: () => void) {
  return listen(MAIN_TOOLS_TARGET_CHANGED, handler);
}
