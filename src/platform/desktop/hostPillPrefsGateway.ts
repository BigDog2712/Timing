/**
 * 主界面 → 悬浮条的偏好搬运（[0.12.1 修复]）
 * -----------------------------------------------------------------------------
 * 为什么需要这一层：设置页（主界面 label `patina`）与悬浮条（label `main`）**不在同一个
 * WebView2 数据目录**里 —— `main_window.rs` 建 patina 窗时设了
 * `.data_directory(webview_root)`，而 conf 静态创建的 main 用 Tauri 默认目录。
 * localStorage 按数据目录分区，于是设置页写的手柄绑定 / 药丸外观落在自己那份存储里，
 * 悬浮条读的是另一份，**怎么调都没反应**（0.12.1 用户实测）。
 *
 * 这里只做一件事：写完本窗那份后广播一次，悬浮条收到后写进它那份再生效
 * （接收侧在 `src/lib/appearanceSync.ts::applyRemotePrefs`）。
 *
 * 走 `emit` 而不是 `emitTo('main', …)`：两窗都在 `core:event:allow-emit` /
 * `allow-listen` 的既有授权里（`capabilities/{patina,default}.json`），不需要动 ACL，
 * 也就不会动契约里那四个数字（命令 / 错误码 / 事件 / emit 点）。广播的载荷自带
 * `appearance` / `handles` 判别键，别的窗口收到也不会误用。
 */
import { emit } from "@tauri-apps/api/event";
import { PILL_PREFS_EVENT } from "../../lib/pillAppearance";
import type { Appearance, PillPrefsPayload } from "../../lib/pillAppearance";

/** 广播失败不能影响设置页：值已经落在本窗，最差是"要重启悬浮条才生效"。 */
function broadcast(payload: PillPrefsPayload): void {
  void emit(PILL_PREFS_EVENT, payload).catch(() => undefined);
}

/** 药丸外观三项（不透明度 ×2 + 常驻形态）改完之后调用。 */
export function broadcastPillAppearance(appearance: Appearance): void {
  broadcast({ appearance });
}

/** 手柄绑定改完之后调用。结构由 `lib/handleBindings` 归一化，这里不解释它。 */
export function broadcastHandleBindings(handles: unknown): void {
  broadcast({ handles });
}
