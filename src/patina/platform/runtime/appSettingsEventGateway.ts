import { emit, listen, type Event } from "@tauri-apps/api/event";
import type { AppSettings } from "../../shared/settings/appSettings.ts";

const APP_SETTINGS_CHANGED_EVENT = "app-settings-changed";

export type AppSettingsChangedPayload = Partial<AppSettings>;

export async function emitAppSettingsChanged(patch: AppSettingsChangedPayload): Promise<void> {
  await emit(APP_SETTINGS_CHANGED_EVENT, patch);
}

export async function onAppSettingsChanged(
  handler: (payload: AppSettingsChangedPayload) => void | Promise<void>,
): Promise<() => void> {
  return listen<unknown>(APP_SETTINGS_CHANGED_EVENT, (event: Event<unknown>) => {
    const payload = event.payload;
    if (!payload || typeof payload !== "object") {
      console.warn("Ignored invalid app-settings-changed payload", payload);
      return;
    }

    void handler(payload as AppSettingsChangedPayload);
  });
}
