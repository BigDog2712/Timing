import { useEffect, useState } from "react";
import {
  createHostThemeSync,
  readHostThemeMode,
  subscribeHostThemeMode,
} from "../../platform/runtime/hostThemeGateway.ts";
import type { ThemeMode } from "../../shared/settings/appSettings.ts";

/**
 * Patina 窗实际使用的主题模式 = 宿主的模式，宿主读不到时才用本地设置。
 *
 * `localMode` 是回落值，不是权威值：融合后 `app_settings.theme_mode` 只在这条窗
 * 拿不到宿主状态时才有意义（首帧、ACL 未就绪、浏览器里单跑）。
 *
 * 订阅与读取的先后、旧值覆盖新事件这两个坑都在 `createHostThemeSync` 里处理，
 * 这里只负责把结果接到 state 上。
 */
export function useHostThemeMode(localMode: ThemeMode): ThemeMode {
  const [hostMode, setHostMode] = useState<ThemeMode | null>(null);

  useEffect(() => createHostThemeSync({
    read: readHostThemeMode,
    subscribe: subscribeHostThemeMode,
    apply: setHostMode,
  }), []);

  return hostMode ?? localMode;
}
