import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ThemeMode } from "../../shared/settings/appSettings.ts";

/**
 * 主题统一（D3）：Patina 窗的**深/浅只认宿主 Timing 的那一个开关**。
 *
 * 融合前两边各存一份 `theme_mode`：宿主的设置页写 `theme_get/theme_set`，
 * Patina 的设置页写自己的 `app_settings.theme_mode`。用户只看见「同一个 App」，
 * 在主窗选深色、进分析窗却是浅的，没有任何解释。
 *
 * 这里不复制主题值，而是直接向宿主要：
 *   `theme_get`       读当前模式（一次，启动时）
 *   `theme-changed`   宿主改了就广播（K-21，所有窗口自订阅）
 *   `theme_set`       Patina 设置页的开关**写回宿主**，两边同时变
 *
 * 三处都包了错误：桌面窗口在宿主库尚未就绪、或 ACL 未授权时会失败。
 * 失败一律返回 null / false，由调用方回落到 Patina 自己的设置——
 * 宁可这条窗是旧主题，也不能因为读不到主题就白屏（`panic=abort` 的同类教训）。
 *
 * 权限在 `src-tauri/permissions/patina-host-theme.toml`：
 * 只读的 `host-theme-read` 给两个 capability（分析窗 + 提醒弹窗），
 * 可写的 `host-theme-write` **只给分析窗**——提醒弹窗没有设置页，不该能改主题。
 */

const THEME_GET = "theme_get";
const THEME_SET = "theme_set";
const THEME_CHANGED = "theme-changed";

const KNOWN_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

function asThemeMode(value: unknown): ThemeMode | null {
  if (typeof value !== "string") return null;
  return (KNOWN_MODES as readonly string[]).includes(value) ? (value as ThemeMode) : null;
}

/** 浏览器（vite 单跑 / 单测）里没有 Tauri 注入对象，直接判否，别让 invoke 抛。 */
function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 读宿主当前主题模式；读不到返回 null（调用方回落本地设置）。 */
export async function readHostThemeMode(): Promise<ThemeMode | null> {
  if (!isTauriRuntime()) return null;
  try {
    const payload = await invoke<{ mode?: unknown }>(THEME_GET);
    return asThemeMode(payload?.mode);
  } catch (error) {
    console.warn("[theme] read host theme failed; falling back to local settings", error);
    return null;
  }
}

/** 把主题模式写回宿主；写成功返回 true。Patina 不再自己保存这个值。 */
export async function writeHostThemeMode(mode: ThemeMode): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke(THEME_SET, { mode });
    return true;
  } catch (error) {
    console.warn("[theme] write host theme failed", error);
    return false;
  }
}

/**
 * 订阅宿主的 `theme-changed`。
 *
 * 载荷是 `ThemeSettings & { accents }`，这里只取 `mode`——四色是宿主的品牌色，
 * Patina 的令牌体系（`--qp-*`）不吃那一套。
 */
export async function subscribeHostThemeMode(
  onMode: (mode: ThemeMode) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await listen<{ mode?: unknown }>(THEME_CHANGED, (event) => {
      const mode = asThemeMode(event.payload?.mode);
      if (mode) onMode(mode);
    });
  } catch (error) {
    console.warn("[theme] subscribe host theme failed", error);
    return null;
  }
}

export interface HostThemeSyncDeps {
  /** 读一次宿主当前模式；读不到返回 null。 */
  read: () => Promise<ThemeMode | null>;
  /** 订阅变化；不可用时返回 null 的取消函数。 */
  subscribe: (onMode: (mode: ThemeMode) => void) => Promise<(() => void) | null>;
  /** 把模式交给界面。 */
  apply: (mode: ThemeMode) => void;
}

/**
 * 「先订阅、后读」的同步器：返回取消函数。
 *
 * 顺序不能反过来。读是异步的，如果先发起读、后订阅，两次之间的变更会丢；
 * 如果读慢、事件先到，读回来的**旧值**还会把新事件盖掉——`received` 就是拦这个的。
 * 抽成纯函数是为了能测：两个竞态都在 `hostThemeGateway.test.ts` 里钉着，
 * 组件里只剩一个 `setState`。
 */
export function createHostThemeSync(deps: HostThemeSyncDeps): () => void {
  let active = true;
  let unlisten: (() => void) | null = null;
  let received = false;

  void (async () => {
    const stop = await deps.subscribe((mode) => {
      received = true;
      if (active) deps.apply(mode);
    });
    if (!active) {
      stop?.();
      return;
    }
    unlisten = stop;
    const mode = await deps.read();
    if (active && !received && mode) {
      deps.apply(mode);
    }
  })();

  return () => {
    active = false;
    unlisten?.();
  };
}
