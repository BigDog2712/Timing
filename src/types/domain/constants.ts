/**
 * TickBar — 领域常量与基础数值类型
 * -----------------------------------------------------------------------------
 * 从 `types/domain.ts` 拆出（原 552 行破 300 行硬约束，见 ADR-017）。
 * 纯常量、无依赖：任何层都可以引，不会形成环。
 */

/** epoch 毫秒时间戳（UTC） */
export type EpochMs = number;

/** 时长（秒，向下取整） */
export type Seconds = number;

/** 系统内置事项「未归类」的固定 id */
export const SYSTEM_ITEM_ID = 1;

/** 结束后撤销窗口（毫秒）。前端与 Rust 侧须一致（IPC-CONTRACT-v2 §8） */
export const UNDO_WINDOW_MS = 3000;

/** 分页默认与上限（IPC-CONTRACT-v2 §1） */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/* ===========================================================================
 * V0.2.0 常量（ARCHITECTURE-V0.2.0 §6）
 * ========================================================================= */

/** 便利贴窗口数上限（内存护栏，K-14）。超限 open_note_window 返回 WINDOW_LIMIT_EXCEEDED */
export const MAX_NOTE_WINDOWS = 20;

/** 倒计时目标上限（秒）= 24h；超限 start_countdown 返回 INVALID_TARGET_SEC */
export const MAX_COUNTDOWN_SEC = 86400;

/** 便利贴正文长度上限（字符） */
export const NOTE_CONTENT_MAX_LEN = 4000;

/** 便利贴窗口尺寸下限（逻辑像素）——硬钳制最小值 */
export const NOTE_MIN_W = 160;
export const NOTE_MIN_H = 120;

/** 便利贴窗口尺寸上限（逻辑像素）——硬钳制最大值；运行时还须再被当前屏 work_area 钳制 */
export const NOTE_MAX_W = 900;
export const NOTE_MAX_H = 900;

/** 便利贴窗口尺寸「舒适上限」（逻辑像素）——软提示，非钳制（拖拽吸附/默认建议） */
export const NOTE_COMFORT_MAX_W = 640;
export const NOTE_COMFORT_MAX_H = 480;

/** 便利贴几何（Moved/Resized）落盘去抖（毫秒，K-23） */
export const NOTE_GEOM_DEBOUNCE_MS = 300;

/** 默认倒计时预设（秒）：5 / 15 / 25 / 30 / 45 / 60 分钟 */
export const DEFAULT_COUNTDOWN_PRESETS: readonly number[] = [300, 900, 1500, 1800, 2700, 3600];

/**
 * 主题快取键（首屏内联脚本同步读取，防白闪 K-18）。
 * [V0.5.0] 改名 `tickbar.theme` → `timing.theme`；老键只读回落一个版本，
 * 见 `src/lib/storageKeys.ts`（唯一读取口径）与 `index.html` 内联脚本（同批改）。
 */
export const THEME_CACHE_KEY = 'timing.theme';

/** [V0.5.0] 老主题键：只读回落，**不删**（回滚 0.4.1 时它的偏好还在） */
export const THEME_CACHE_KEY_LEGACY = 'tickbar.theme';
