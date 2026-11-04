/**
 * Timing — 多窗口路由与窗口壳辅助（ADR-009 §1：label 路由）
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
import { ipc, isTauri } from '../services/ipc';
import { IS_MOBILE } from './platform';

/**
 * 本文件是**全前端唯一的窗口 API 出口**（R2）。
 *
 * 任何组件 / hook 都不得直接 `import '@tauri-apps/api/window'`——窗口能力与"多窗口
 * 单 bundle"的路由假设强绑定（label 命名、note-{id} 前缀、非 Tauri 的 `?w=` 回退），
 * 散落到各处会让「新增一类窗口」变成全仓搜索。
 * 机械门禁：`grep -rl "@tauri-apps/api/window" src` = 1（只允许本文件）。
 */
export { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
export type { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';

export type WindowKind = 'main' | 'settings' | 'todos' | 'timer' | 'note' | 'panel';

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
  if (label === 'timer') return 'timer';
  // Tauri 下 label = note-{id}；浏览器 dev 下回退的 `?w=note` 只会得到 'note'（无 id 后缀），
  // 两种都要认，否则便利贴窗在 dev 里会被当成主窗渲染。
  if (label === 'note' || label.startsWith('note-')) return 'note';
  // 插件面板：label = panel-{pluginId}-{panelId}（v3）。
  if (label === 'panel' || label.startsWith('panel-')) return 'panel';
  return 'main';
}

/**
 * 插件面板窗口的目标（`?plugin=&panel=`）。
 *
 * **不从 label 拆**：插件 id 与面板 id 都允许含 `-`（如 `moyu-kit` / `weekly-report`），
 * `panel-moyu-kit-weekly` 无法反解出正确边界。label 只负责「同一面板不重复开窗」，
 * 真正的身份放在查询参数里——建窗代码（`infra::window_panel`）两处都会写。
 */
export function currentPanelTarget(): { pluginId: string; panelId: string } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const pluginId = params.get('plugin');
    const panelId = params.get('panel');
    if (pluginId && panelId) return { pluginId, panelId };
  } catch {
    /* 忽略 */
  }
  return null;
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

/**
 * 主条（label = `main`）在屏幕上的**逻辑矩形**（DIP），供「浮层默认落在小条附近」使用。
 *
 * 为什么不是 `getCurrentWindow()`：调用方可能是事项窗 / 便利贴窗（在那边点「新建便利贴」），
 * 拿到的是**它自己**的位置，落点就会跑偏。
 *
 * 为什么不是 `Window.getByLabel('main')`：它内部走 `get_all_windows`，需要
 * `core:window:allow-get-all-windows` 权限——本项目的能力白名单没有放行，调用会
 * **静默失败**（catch 吃掉 → 退回固定落点），这正是「改了落点但没生效」的根因。
 * 改走 IPC `main_window_rect`：后端直接读主窗，不依赖前端窗口枚举权限。
 *
 * 读不到（非 Tauri / 主窗尚未创建）→ `null`，调用方退回固定落点。
 */
export async function mainWindowRect(): Promise<{ x: number; y: number; w: number; h: number } | null> {
  if (!isTauri()) return null;
  try {
    const rect = await ipc.mainWindowRect();
    if (!(rect.w > 0) || !(rect.h > 0)) return null;
    return rect;
  } catch {
    return null;
  }
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
  /* 移动端只有一个随 Activity 出现的全屏窗，没有「visible:false 等首帧再 show」这回事：
     `setSkipTaskbar` 在 Android 也没有对应概念，整段直接空转。 */
  if (IS_MOBILE || !isTauri()) return () => undefined;
  /* [V0.2.8] 设置面板 / 事项窗是浮层，不该在任务栏留按钮。
     tao 的 `skip_taskbar` 走的是 `ITaskbarList::DeleteTab`（只删已存在的按钮），
     窗口 `show()` 之后外壳可能又把按钮加回来——所以显示后再删一次。 */
  const keepOffTaskbar = (win: ReturnType<typeof getCurrentWindow>) => {
    const kind = currentWindowKind();
    if (kind !== 'settings' && kind !== 'todos' && kind !== 'timer') return;
    void win
      .setSkipTaskbar(true)
      .catch(() => undefined);
  };
  const show = () => {
    if (windowShown) return;
    windowShown = true;
    const win = getCurrentWindow();
    void win
      .show()
      .then(() => keepOffTaskbar(win))
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

/* 便利贴的运行期置顶**不在这里**：统一由后端 `infra::window_note::apply_note_pin`
   在服务端完成（落库 + 当场改窗口层级），前端不再提供切换入口（ADR-022）。
   需要改置顶时走 `ipc.noteUpdate({ id, patch: { isPinned } })`。 */

/**
 * [V0.2.1] 让「当前窗口」跟随鼠标拖动（主小条整条可拖，1.3）。
 * 依赖 capability `core:window:allow-start-dragging`（`src-tauri/capabilities/default.json:7`）。
 * 非 Tauri 为 no-op；失败静默（拖不起来不该打断计时交互）。
 */
export function startCurrentWindowDrag(): Promise<void> {
  /* 手机没有「拖动窗口」：整屏固定布局（PRD §5 D9），调用方按 no-op 收敛 */
  if (IS_MOBILE || !isTauri()) return Promise.resolve();
  return getCurrentWindow()
    .startDragging()
    .catch(() => undefined);
}

/**
 * [V0.2.4 · 2] 让「当前窗口」进入系统级缩放拖动（便利贴右下角手柄用）。
 * 依赖 capability `core:window:allow-start-resize-dragging`。
 * 非 Tauri 为 no-op；失败静默（缩放手柄失灵不该影响写作）。
 * 注：`ResizeDirection` 在 @tauri-apps/api 里是本地类型未导出，这里按同构联合重声明。
 */
export type ResizeDir =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

export function startCurrentWindowResize(direction: ResizeDir = 'SouthEast'): Promise<void> {
  if (IS_MOBILE || !isTauri()) return Promise.resolve();
  return getCurrentWindow()
    .startResizeDragging(direction)
    .catch(() => undefined);
}

/**
 * [V0.2.8] 隐藏当前窗口（不销毁）：事项窗「指针离开即隐藏」用。
 * 依赖 capability `core:window:allow-hide`（`src-tauri/capabilities/default.json` 已含 core:window 默认集）。
 * 非 Tauri 为 no-op；失败静默。
 */
export function hideCurrentWindow(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return getCurrentWindow()
    .hide()
    .catch(() => undefined);
}
