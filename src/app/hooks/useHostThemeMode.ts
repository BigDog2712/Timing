import { useEffect, useState } from "react";
import {
  createHostThemeSync,
  readHostThemeSnapshot,
  subscribeHostTheme,
  type HostThemeSnapshot,
} from "../../platform/runtime/hostThemeGateway.ts";
import type { ThemeMode } from "../../shared/settings/appSettings.ts";
import type { HostAccentColors } from "../../shared/theme/hostAccentBridge.ts";

/** Patina 窗实际使用的主题：深/浅 + 四色，两者都只认宿主。 */
export interface HostTheme {
  mode: ThemeMode;
  /** 读不到宿主四色时为 null：配色回落 28 套预设，界面照常可用。 */
  accents: HostAccentColors | null;
}

/**
 * Patina 窗实际使用的主题 = 宿主的「模式 + 四色」，宿主读不到时才用本地设置 / 预设色。
 *
 * `localMode` 是**回落值**，不是权威值：融合后 `app_settings.theme_mode` 只在这条窗拿不到
 * 宿主状态时才有意义（首帧、ACL 未就绪、浏览器里单跑）。四色没有本地副本——宿主才是唯一
 * 真相，所以这里**不**把 accents 写进 Patina 自己的 `app_settings`。
 *
 * 「先订阅、后读」的先后与旧值覆盖新事件这两个坑都在 `createHostThemeSync` 里处理（同一个
 * 同步器同时管模式和四色，避免订阅两遍、也避免两条竞态各写一份）。文件名保留 `useHostThemeMode`
 * 以免动调用面；导出名改成 `useHostTheme`，因为它现在不只给模式。
 */
export function useHostTheme(localMode: ThemeMode): HostTheme {
  const [host, setHost] = useState<HostThemeSnapshot | null>(null);

  useEffect(() => createHostThemeSync<HostThemeSnapshot>({
    read: readHostThemeSnapshot,
    subscribe: subscribeHostTheme,
    apply: setHost,
  }), []);

  return { mode: host?.mode ?? localMode, accents: host?.accents ?? null };
}
