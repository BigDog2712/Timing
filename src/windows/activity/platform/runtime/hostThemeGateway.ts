import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ThemeMode } from "../../shared/settings/appSettings.ts";
import type { HostAccentColors } from "../../shared/theme/hostAccentBridge.ts";

/**
 * 主题统一（D3 + P0-01）：Patina 窗的**深/浅与四色都只认宿主 Timing**。
 * 融合前两边各存一份 `theme_mode`、各有一套主色：用户只看见「同一个 App」，主窗选深色、
 * 进分析窗却是浅的；改主色还得改两处。这里不复制主题值，直接向宿主要：
 *   `theme_get`     读当前模式；`accent_get` 读当前四色（一次，启动时）
 *   `theme-changed` 宿主改了就广播（K-21，各窗自订阅），载荷本就带 `accents`
 *   `theme_set`     [P0-06] 分析窗那个开关**已下线**：`writeHostThemeMode` 当前零调用，
 *                   且 `capabilities/patina.json` 也不再授予 `host-theme-write`——双保险
 * **不新增命令、不新增事件**：`accent_get` 早已存在（`commands/theme_cmd.rs`），
 * `theme-changed` 的载荷 `ThemeChanged { mode, accents }`（`services/theme.rs`）本来就带四色，
 * 只是过去没人订阅。本轮只把 `accent_get` 加进 `host-theme-read` 权限。
 * 每个出入口都包了错误：桌面窗口在宿主库未就绪、或 ACL 未授权时会失败，一律返回 null /
 * false 让调用方回落预设——宁可这扇窗是旧主题，也不能读不到主题就白屏（`panic=abort` 教训）。
 * 权限在 `src-tauri/permissions/patina-host-theme.toml`：只读的 `host-theme-read` 给分析窗
 * 与提醒弹窗；`host-theme-write`（`theme_set`）**已不再授予任何 capability**（P0-06 摘除）——
 * 分析窗对宿主的写能力现在是零，不只是「零**计时**写」。
 */
const THEME_GET = "theme_get";
const THEME_SET = "theme_set";
const ACCENT_GET = "accent_get";
const THEME_CHANGED = "theme-changed";

function asThemeMode(value: unknown): ThemeMode | null {
  if (typeof value !== "string") return null;
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

/** 四色载荷的形状校验：三个主色必须是字符串，`bar` 可为空（= 跟随主题令牌）。 */
function asHostAccents(value: unknown): HostAccentColors | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.running !== "string" || typeof raw.warn !== "string" || typeof raw.done !== "string") return null;
  return { running: raw.running, warn: raw.warn, done: raw.done, bar: typeof raw.bar === "string" ? raw.bar : null };
}

/** 浏览器（vite 单跑 / 单测）里没有 Tauri 注入对象，直接判否，别让 invoke 抛。 */
const isTauriRuntime = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** invoke + 形状校验 + 出错只警告不抛：所有「向宿主要东西」的读取都走这里。 */
async function guarded<T>(command: string, as: (raw: unknown) => T | null, failure: string): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    return as(await invoke(command));
  } catch (error) {
    console.warn(`[theme] ${failure}; falling back to local settings`, error);
    return null;
  }
}

/** 读宿主当前主题模式；读不到返回 null（调用方回落本地设置）。 */
export function readHostThemeMode(): Promise<ThemeMode | null> {
  return guarded(THEME_GET, (raw) => asThemeMode((raw as { mode?: unknown } | null)?.mode), "read host theme failed");
}

/** 读宿主当前四色；读不到返回 null（调用方回落 28 套预设色）。 */
export function readHostAccents(): Promise<HostAccentColors | null> {
  return guarded(ACCENT_GET, asHostAccents, "read host accents failed");
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

/** 宿主主题的完整快照：模式决定深/浅，四色决定强调/语义色（P0-01）。 */
export interface HostThemeSnapshot {
  mode: ThemeMode;
  /** 四色读不到时为 null——链路照旧，只是配色回落预设。 */
  accents: HostAccentColors | null;
}

/** 读一次「模式 + 四色」；模式读不到返回 null（调用方回落本地设置）。 */
export async function readHostThemeSnapshot(): Promise<HostThemeSnapshot | null> {
  const [mode, accents] = await Promise.all([readHostThemeMode(), readHostAccents()]);
  return mode ? { mode, accents } : null;
}

/**
 * 订阅宿主的 `theme-changed`，一次给出**模式与四色**。载荷是 `ThemeChanged { mode, accents }`
 * （`services/theme.rs:24-30`）——四色本来就在广播里，所以改主色不需要新事件。
 * 缺 `accents` 时给 null（旧宿主 / 半载荷），上层回落预设色，不会把已生效的配色清空。
 */
export async function subscribeHostTheme(
  onSnapshot: (snapshot: HostThemeSnapshot) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await listen<{ mode?: unknown; accents?: unknown }>(THEME_CHANGED, (event) => {
      const mode = asThemeMode(event.payload?.mode);
      if (mode) onSnapshot({ mode, accents: asHostAccents(event.payload?.accents) });
    });
  } catch (error) {
    console.warn("[theme] subscribe host theme failed", error);
    return null;
  }
}

/** 同步器的依赖（泛型默认 `ThemeMode`，老调用点按 mode 单值用）。 */
export interface HostThemeSyncDeps<T = ThemeMode> {
  /** 读一次宿主当前值；读不到返回 null。 */
  read: () => Promise<T | null>;
  /** 订阅变化；不可用时返回 null 的取消函数。 */
  subscribe: (onValue: (value: T) => void) => Promise<(() => void) | null>;
  /** 把值交给界面。 */
  apply: (value: T) => void;
}

/**
 * 「先订阅、后读」的同步器：返回取消函数。顺序不能反过来：读是异步的，先读后订阅会丢掉
 * 两次之间的变更；读慢而事件先到，读回来的**旧值**还会把新事件盖掉——`received` 就是拦这个的。
 * 抽成纯函数是为了能测：两个竞态都在 `hostThemeGateway.test.ts` 里钉着；泛型让「模式 + 四色」
 * 共用同一份竞态处理（`createHostThemeSync<HostThemeSnapshot>`），不必再写第二份。
 */
export function createHostThemeSync<T = ThemeMode>(deps: HostThemeSyncDeps<T>): () => void {
  let active = true;
  let unlisten: (() => void) | null = null;
  let received = false;

  void (async () => {
    const stop = await deps.subscribe((value) => {
      received = true;
      if (active) deps.apply(value);
    });
    if (!active) {
      stop?.();
      return;
    }
    unlisten = stop;
    const value = await deps.read();
    if (active && !received && value) {
      deps.apply(value);
    }
  })();

  return () => {
    active = false;
    unlisten?.();
  };
}
