/**
 * Timing — 高亮定位（V0.3.1）
 * -----------------------------------------------------------------------------
 * 入口：托盘图标**双击**（Rust emit `tray:highlight`）。
 * 行为：把「高亮颜色」写到 `:root --highlight-color`，再让小条闪三下。
 *
 * 颜色为什么现读而不是启动时缓存：设置面板是**另一个窗口**，改完不会经过主窗，
 * 主窗也就没有刷新时机；双击这一刻读一次（`get_reference_settings`）既省一条广播事件，
 * 也保证「改完立刻双击」能看到新颜色。
 *
 * 颜色存 `timing.highlight_color`（ReferenceSettings.highlightColor）——该键早已存在
 * （Timing 参考设置），默认 #4DA3E8，无需新增表结构或后端字段。
 */
import { ipc } from './ipc';
import { useUiStore } from '../stores/uiStore';

/** 与后端 `ReferenceSettings::default().highlight_color` 同值（读失败时兜底） */
const FALLBACK_COLOR = '#4DA3E8';

/** 颜色合法性：#RGB / #RRGGBB（设置面板写入前也校验一次） */
export function isValidHighlightColor(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** 把高亮色写到根节点（CSS 变量供 .pill[data-highlight] 使用） */
export function applyHighlightColor(color: string): void {
  const safe = isValidHighlightColor(color) ? color.trim() : FALLBACK_COLOR;
  try {
    document.documentElement.style.setProperty('--highlight-color', safe);
  } catch {
    /* 非 DOM 环境（测试）忽略 */
  }
}

/** 托盘双击触发的完整动作：取色 → 应用 → 让小条闪一下 */
export async function highlightPill(): Promise<void> {
  try {
    const reference = await ipc.getReferenceSettings();
    applyHighlightColor(reference.highlightColor);
  } catch {
    applyHighlightColor(FALLBACK_COLOR);
  }
  useUiStore.getState().flashHighlight();
}
