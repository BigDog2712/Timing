import { invoke } from "@tauri-apps/api/core";
/* 窗口 API 走宿主薄壳（纯 re-export）：直接引窗口 API 包会与 src/lib/window.ts 一起
   把宿主 IPC 全表拖进分析窗 bundle。见 src/lib/windowApi.ts。 */
import { getCurrentWebviewWindow, getCurrentWindow, LogicalSize } from "../../lib/windowApi";

interface CurrentWindowForegroundState {
  visible: boolean;
  focused: boolean;
  foregroundLike: boolean;
}

type MainWindowReadyOutcome = "stale" | "duplicate" | "hidden" | "revealed";

interface MainWindowReadyResult {
  outcome: MainWindowReadyOutcome;
  generation: number;
  loadEpoch: number;
}

interface MainWindowRenderToken {
  generation: number;
  loadEpoch: number;
}

declare global {
  interface Window {
    __PATINA_MAIN_WINDOW_GENERATION__?: number;
  }
}

const MAIN_WINDOW_LABEL = "patina";
const MAIN_WINDOW_READY_OUTCOMES = new Set<MainWindowReadyOutcome>([
  "stale",
  "duplicate",
  "hidden",
  "revealed",
]);

function parseMainWindowReadyResult(value: unknown): MainWindowReadyResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("main-window ready command returned an invalid result");
  }

  const candidate = value as {
    outcome?: unknown;
    generation?: unknown;
    loadEpoch?: unknown;
  };
  if (
    typeof candidate.outcome !== "string"
    || !MAIN_WINDOW_READY_OUTCOMES.has(candidate.outcome as MainWindowReadyOutcome)
    || typeof candidate.generation !== "number"
    || !Number.isSafeInteger(candidate.generation)
    || candidate.generation < 1
    || typeof candidate.loadEpoch !== "number"
    || !Number.isSafeInteger(candidate.loadEpoch)
    || candidate.loadEpoch < 1
  ) {
    throw new Error("main-window ready command returned an invalid contract");
  }

  return {
    outcome: candidate.outcome as MainWindowReadyOutcome,
    generation: candidate.generation,
    loadEpoch: candidate.loadEpoch,
  };
}

function parseMainWindowRenderToken(value: unknown): MainWindowRenderToken {
  if (typeof value !== "object" || value === null) {
    throw new Error("main-window render token command returned an invalid result");
  }

  const candidate = value as { generation?: unknown; loadEpoch?: unknown };
  if (
    typeof candidate.generation !== "number"
    || !Number.isSafeInteger(candidate.generation)
    || candidate.generation < 1
    || typeof candidate.loadEpoch !== "number"
    || !Number.isSafeInteger(candidate.loadEpoch)
    || candidate.loadEpoch < 1
  ) {
    throw new Error("main-window render token command returned an invalid contract");
  }

  return {
    generation: candidate.generation,
    loadEpoch: candidate.loadEpoch,
  };
}

export function readCurrentMainWindowGeneration(): number | null {
  if (typeof window === "undefined" || getCurrentWindow().label !== MAIN_WINDOW_LABEL) {
    return null;
  }

  const generation = window.__PATINA_MAIN_WINDOW_GENERATION__;
  return typeof generation === "number"
    && Number.isSafeInteger(generation)
    && generation >= 1
    ? generation
    : null;
}

export async function markCurrentMainWindowReady(
  token: MainWindowRenderToken,
): Promise<MainWindowReadyResult> {
  if (getCurrentWindow().label !== MAIN_WINDOW_LABEL) {
    throw new Error("only the main window can report main-window readiness");
  }

  return parseMainWindowReadyResult(await invoke<unknown>("cmd_mark_main_window_ready", {
    generation: token.generation,
    loadEpoch: token.loadEpoch,
  }));
}

export async function readCurrentMainWindowRenderToken(): Promise<MainWindowRenderToken> {
  if (getCurrentWindow().label !== MAIN_WINDOW_LABEL) {
    throw new Error("only the main window can read main-window render state");
  }

  return parseMainWindowRenderToken(
    await invoke<unknown>("cmd_get_main_window_render_token"),
  );
}

export async function minimizeCurrentWindow(): Promise<void> {
  await invoke("cmd_minimize_main_window");
}

export async function showDesktop(): Promise<void> {
  await invoke("cmd_show_desktop");
}

export async function toggleCurrentWindowMaximized(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

export async function closeCurrentWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function startCurrentWindowDrag(): Promise<void> {
  await getCurrentWindow().startDragging();
}

/* ── [v3.1] 主界面窗口大小记忆 ──
 * 两件事：**读逻辑尺寸**（存的是逻辑像素，换显示器/改缩放比都不会漂）与**按逻辑尺寸改窗**。
 * 不用 `innerSize()` 原样存取的理由：它返回物理像素，125% 屏上存 1240×826、换到 100% 屏
 * 回填就变成一块比预期大 25% 的板（这正是 `window_spec.rs` 那条 K-15 注释在躲的坑）。 */

export interface LogicalWindowSize {
  width: number;
  height: number;
}

export async function readCurrentWindowLogicalSize(): Promise<LogicalWindowSize | null> {
  try {
    const currentWindow = getCurrentWindow();
    const [size, scale] = await Promise.all([currentWindow.innerSize(), currentWindow.scaleFactor()]);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const width = size.width / scale;
    const height = size.height / scale;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width: Math.round(width), height: Math.round(height) };
  } catch (error) {
    console.warn("read current window size failed", error);
    return null;
  }
}

export async function resizeCurrentWindowTo(size: LogicalWindowSize): Promise<boolean> {
  try {
    await getCurrentWindow().setSize(
      new LogicalSize(Math.round(size.width), Math.round(size.height)),
    );
    return true;
  } catch (error) {
    console.warn("resize current window failed", error);
    return false;
  }
}

/** 只回调，不读状态：读尺寸要两条 IPC，节流放在调用方（`useMainWindowSizeMemory`）。 */
export async function watchCurrentWindowResized(handler: () => void): Promise<() => void> {
  return getCurrentWindow().onResized(() => handler());
}

export async function readCurrentWindowMaximized(): Promise<boolean> {
  try {
    return await getCurrentWindow().isMaximized();
  } catch (error) {
    console.warn("read current window maximized state failed", error);
    return false;
  }
}

export async function watchCurrentWindowMaximized(
  handler: (maximized: boolean) => void,
): Promise<() => void> {
  const currentWindow = getCurrentWindow();

  const syncMaximizedState = () => {
    void currentWindow.isMaximized()
      .then(handler)
      .catch((error) => {
        console.warn("read current window maximized state failed", error);
      });
  };

  syncMaximizedState();
  return currentWindow.onResized(syncMaximizedState);
}

export async function readCurrentWindowForegroundState(): Promise<CurrentWindowForegroundState> {
  try {
    const currentWindow = getCurrentWindow();
    const [visible, focused] = await Promise.all([
      currentWindow.isVisible(),
      currentWindow.isFocused(),
    ]);

    return {
      visible,
      focused,
      foregroundLike: visible || focused,
    };
  } catch (error) {
    console.warn("read current window foreground state failed", error);
    return {
      visible: true,
      focused: true,
      foregroundLike: true,
    };
  }
}

export async function watchCurrentWindowForegroundState(
  handler: (state: CurrentWindowForegroundState) => void,
): Promise<() => void> {
  const currentWindow = getCurrentWindow();

  const syncForegroundState = () => {
    void readCurrentWindowForegroundState().then(handler);
  };
  const unlisteners: Array<() => void> = [];

  syncForegroundState();

  try {
    unlisteners.push(await currentWindow.onFocusChanged(syncForegroundState));
    unlisteners.push(await currentWindow.onResized(syncForegroundState));
  } catch (error) {
    for (const unlisten of unlisteners.splice(0)) {
      unlisten();
    }
    console.warn("watch current window foreground state failed", error);
  }

  return () => {
    for (const unlisten of unlisteners.splice(0)) {
      unlisten();
    }
  };
}

export function resolveCurrentAppWindowLabel(): "main" | "mini" | "tool-notification" {
  try {
    const label = getCurrentWindow().label || getCurrentWebviewWindow().label;
    return label === "mini" || label === "tool-notification" ? label : "main";
  } catch {
    return "main";
  }
}

export async function showMainWindow(): Promise<void> {
  await invoke("cmd_show_main_window");
}
