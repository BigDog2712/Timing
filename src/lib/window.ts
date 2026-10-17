/**
 * TickBar — 多窗口路由与窗口壳辅助（ADR-009 §1：label 路由）
 * -----------------------------------------------------------------------------
 * 载体：Tauri `getCurrentWindow().label`（main / settings / todos / note-{id}）。
 * 非 Tauri（浏览器 dev）回退到 `?w=settings`，便于单窗走查。
 * 另提供：
 *  - markWindowKind()：把窗口类别写到 <html data-window>，供 CSS 按窗切换尺寸/底。
 *  - showCurrentWindowOnReady()：K-18 防白闪三件套——visible:false 创建的窗口在首帧
 *    就绪后自行 show（双 rAF + 定时器兜底，与主窗 A0/D-07 同思路，只显示一次）。
 *  - closeCurrentWindow()：自绘标题栏 × 的关闭动作。
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../services/ipc';

export type WindowKind = 'main' | 'settings' | 'todos' | 'note';

/** 当前窗口 label（Tauri）；非 Tauri 回退 ?w= */
export function currentWindowLabel(): string {
  try {
    if (isTauri()) return getCurrentWindow().label;
  } catch {
    /* 非 Tauri 或 API 不可用时回退 */
  }
  try {
    const w = new URLSearchParams(window.location.search).get('w');
    if (w) return w;
  } catch {
    /* 忽略 */
  }
  return 'main';
}

/** 当前窗口类别（label -> kind） */
export function currentWindowKind(): WindowKind {
  const label = currentWindowLabel();
  if (label === 'settings') return 'settings';
  if (label === 'todos') return 'todos';
  if (label.startsWith('note-')) return 'note';
  return 'main';
}

/**
 * 便利贴窗口的 note id（label `note-{id}` -> id；非 note 窗 / 解析失败 -> null）。
 * 供 NoteWindow 首帧 note_get 使用（ADR-009 §1 动态 label 路由）。
 */
export function currentNoteId(): number | null {
  const label = currentWindowLabel();
  // Tauri：label = note-{id}
  if (label.startsWith('note-')) {
    const id = Number.parseInt(label.slice('note-'.length), 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  // 非 Tauri（浏览器 dev）：URL = index.html?w=note&id={id}（与后端约定一致）
  if (label === 'note') {
    try {
      const id = Number.parseInt(new URLSearchParams(window.location.search).get('id') ?? '', 10);
      return Number.isFinite(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 把窗口类别写到 <html data-window>（供 CSS 按窗切换根尺寸/底色） */
export function markWindowKind(): WindowKind {
  const kind = currentWindowKind();
  try {
    document.documentElement.dataset.window = kind;
  } catch {
    /* 忽略 */
  }
  return kind;
}

/** K-18 防白闪：首帧就绪后显示当前窗口（只显示一次；cleanup 取消未执行的 rAF/定时器） */
let windowShown = false;
export function showCurrentWindowOnReady(): () => void {
  if (!isTauri()) return () => undefined;
  const show = () => {
    if (windowShown) return;
    windowShown = true;
    void getCurrentWindow()
      .show()
      .catch(() => undefined);
  };
  let raf1 = 0;
  let raf2 = 0;
  raf1 = requestAnimationFrame(() => {
    raf2 = requestAnimationFrame(show);
  });
  const timer = window.setTimeout(show, 50);
  return () => {
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    window.clearTimeout(timer);
  };
}

/** 关闭当前窗口（自绘标题栏 × 的动作；非 Tauri 为 no-op） */
export function closeCurrentWindow(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return getCurrentWindow()
    .close()
    .catch(() => undefined);
}

/**
 * 设置「当前窗口」的置顶态（便利贴运行期 pin，AC-64）。非 Tauri 为 no-op。
 * 注意：**勿用** `ipc.setAlwaysOnTop` —— 该 IPC 命令固定作用于**主窗**并落库全局设置
 *       `ui.always_on_top`（属设置面板契约）；对 note-{id} 窗无效且会产生全局副作用。
 * 失败时 reject（调用方据此回滚 UI 态）。
 */
export function setCurrentWindowAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return getCurrentWindow().setAlwaysOnTop(enabled);
}
