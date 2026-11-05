/**
 * TickBar — 插件域类型（V0.3.2）
 * -----------------------------------------------------------------------------
 * 与 `src-tauri/src/models/plugin.rs` 逐字对应（`#[serde(rename_all = "camelCase")]`）。
 *
 * 插件是**声明式**的：宿主读 `<插件目录>/plugin.json`（启动头），不执行插件代码。
 * - v1：`quickTimers`（摸鱼菜单的预设行）；
 * - v2：新增 `mdSync`（Markdown 双向同步落点）。
 * 字段语义见 `docs/plugin-spec.md`。
 */

import type { MdSyncContribution } from './mdSync';

/** 摸鱼菜单的一行：事项名 + 目标倒计时分钟数 */
export interface QuickTimer {
  item: string;
  minutes: number;
}

/**
 * 插件来源。同 id 冲突时按 dev > exe > user 先到先得：
 * - `dev` 仅调试构建（仓库根 `plugins/`）；
 * - `exe` 随包分发（exe 同级 `plugins/`）；
 * - `user` 用户目录（`%APPDATA%\com.timing.app\plugins`）。
 *
 * 没有 `builtin`：摸鱼菜单的出厂预设是应用内置功能，不是插件。
 * [V0.3.4] 出厂预设也不再随 `plugin_list` 回传（ADR-023）——设置页不展示内置功能，
 * 它只在后端 `builtin_quick_timers()` 内部当合并底座用。
 */
export type PluginSource = 'dev' | 'exe' | 'user';

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  /** 启动头声明的 API 版本；宿主当前支持 2 */
  apiVersion: number;
  description: string;
  source: PluginSource;
  /** 插件目录 */
  dir: string;
  enabled: boolean;
  /** 载入失败原因（非空 = 该插件没有生效，设置页原样展示） */
  error: string | null;
  /** 该插件声明的快捷计时（未生效时后端也会回填，但不会进合并结果） */
  quickTimers: QuickTimer[];
  /** [v2] 该插件声明的 Markdown 同步落点；未生效时为 null */
  mdSync: MdSyncContribution | null;
}

export interface PluginListResult {
  /** 用户插件目录（可写、可打开） */
  dir: string;
  plugins: PluginInfo[];
  /** 已合并去重的最终菜单项：后端算好，前端直接用 */
  quickTimers: QuickTimer[];
}
