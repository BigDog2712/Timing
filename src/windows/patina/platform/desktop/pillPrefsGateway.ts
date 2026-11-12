/**
 * Timing — 悬浮条外观 / 手柄绑定的**读写网关**（[0.12.1 归一] 单一真源）
 * -----------------------------------------------------------------------------
 * 真源是宿主设置表里的**一个** KV 键（Rust `timing.pill_prefs`，`get_settings` 的 `pill`
 * 字段 / `update_settings` 的 `patch.pill`）。本文件是它在前端的唯一出入口：
 *
 *   · 写（设置页，分析窗）：save → Rust 落库 → `nudgePillPrefs()` 发一个无载荷信号；
 *   · 读（悬浮条，主窗）：`loadPillPrefs()` → 归一化 → 应用到 store + 回写本窗缓存；
 *   · 迁移：`seedPillPrefsIfAbsent()` 只在库里还是 `null` 时把本窗缓存写进去一次。
 *
 * 为什么不再让两窗各自写 localStorage：悬浮条窗（`main`）与分析窗（`patina`，设置页）
 * 不在同一个 WebView2 数据目录（`main_window.rs` 给后者设了 `.data_directory`），
 * localStorage 按数据目录分区 —— 0.12.1 靠广播搬运对齐是权宜之计，真源始终是两份。
 * 现在 localStorage 只做首帧缓存，**不参与任何判定**。
 *
 * 错误口径：**读一律不 throw**（返回 null 表示「没有 / 不可用 / 坏了」），药丸启动不能
 * 因为读设置而崩；**写必须 throw**（设置页要把失败显示成红字），唯一例外是「根本不在
 * 桌面宿主里」——那时没有宿主表可写，本地缓存已经由调用方落好，报错只会让浏览器预览
 * 变成只读加红字。
 */
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { PILL_PREFS_EVENT, parsePillPrefs } from "../../../timing/lib/pillAppearance";
import type { PillPrefs, PillPrefsPatch } from "../../../timing/lib/pillAppearance";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** `get_settings` 只用到 `pill` 一个字段；其余字段原样忽略（本文件不解释设置表）。 */
interface SettingsWithPill {
  pill?: unknown;
}

/** 读库里的偏好快照。非 Tauri / 命令缺失 / 坏形状 → `null`（调用方保留现值）。 */
export async function loadPillPrefs(): Promise<PillPrefs | null> {
  if (!isTauriRuntime()) return null;
  try {
    const settings = await invoke<SettingsWithPill>("get_settings");
    return parsePillPrefs(settings?.pill ?? null);
  } catch {
    return null;
  }
}

/**
 * 写半份 patch（外观卡只发 `appearance`，手柄面板只发 `handles`）。
 *
 * 合并与归一都在 Rust 侧做（`merge_pill_prefs`）：前端发半份、后端读旧补另一半再写全量，
 * 这样「只写一半」在物理上不可能把另一份抹掉。
 */
export async function savePillPrefs(patch: PillPrefsPatch): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("update_settings", { patch: { pill: patch } });
}

/**
 * 迁移的唯一入口：库里 `pill` 还是 `null`（从没写过）时，把本窗缓存写进去一次。
 *
 * 为什么需要它：用户 0.12.1 里调过的手柄绑定 / 外观只落在 localStorage（两窗各一份），
 * 升级到本版时库是空的。不搬的话「以前调好的都不见了」。写过一次之后就以库为准 ——
 * 所以判据是 `pill == null`，而不是「本地值与库不同」（那样每次启动都会互相覆盖）。
 */
export async function seedPillPrefsIfAbsent(cache: PillPrefs): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const settings = await invoke<SettingsWithPill>("get_settings");
    if (settings?.pill != null) return;
    await invoke("update_settings", { patch: { pill: cache } });
  } catch {
    /* 迁移失败对用户不可操作，且下次启动会自动重试（库里仍是 null）——静默即可 */
  }
}

/**
 * 发一个「该重读了」的信号（**无载荷**）。
 *
 * 用 `emit`（广播）而不是 `emitTo('main', …)`：两窗都在既有 `core:event:allow-emit` /
 * `allow-listen` 授权里，不必动 ACL，契约的事件 / emit 计数也不变。失败吞掉 —— 值已经
 * 落库，最差是等到下一次 focus 才生效。
 */
export function nudgePillPrefs(): void {
  void emit(PILL_PREFS_EVENT).catch(() => undefined);
}
