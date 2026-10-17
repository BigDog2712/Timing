//! 领域常量（须与前端 `domain.ts` 及 IPC-CONTRACT-v2 保持一致）。

/// 系统内置事项「未归类」固定 id。
pub const SYSTEM_ITEM_ID: i64 = 1;

/// 结束后撤销窗口（毫秒）。前端 `UNDO_WINDOW_MS` 同值。
pub const UNDO_WINDOW_MS: i64 = 3000;

/// 撤销窗口服务端容差（毫秒）。
pub const UNDO_TOLERANCE_MS: i64 = 200;

/// 分页默认条数。
pub const DEFAULT_PAGE_SIZE: i64 = 20;

/// 分页上限（超限按上限截断）。
pub const MAX_PAGE_SIZE: i64 = 100;

/// 备注最大长度（字符）。
pub const NOTE_MAX_LEN: usize = 500;

/// 待办标题最大长度（字符，schema-V0.2.0 §todos.title / domain-v020.ts:100「长度 1-200」）。
pub const TODO_TITLE_MAX_LEN: usize = 200;

/// 便利贴正文最大长度（字符，schema-V0.2.0 §notes.content）。
pub const NOTE_CONTENT_MAX_LEN: usize = 4000;

/// 运行中落盘间隔（秒）。崩溃丢失 ≤ 2 个间隔（≤30s）。
pub const FLUSH_INTERVAL_SECS: u64 = 15;

/// 倒计时预设上限（个）。
pub const COUNTDOWN_PRESETS_MAX: usize = 8;

/* V0.2.0 批 2 常量（ADR-009 / ADR-010 / ADR-011） */
/// 便利贴窗口数上限（内存护栏，K-14）。超限 `open_note_window` → `WINDOW_LIMIT_EXCEEDED`。
pub const MAX_NOTE_WINDOWS: usize = 20;

/// 便利贴硬钳制尺寸下限（逻辑像素）。
pub const NOTE_MIN_W: f64 = 160.0;
pub const NOTE_MIN_H: f64 = 120.0;

/// 便利贴硬钳制尺寸上限（逻辑像素）；运行时再受当前屏 `work_area` 收窄。
pub const NOTE_MAX_W: f64 = 900.0;
pub const NOTE_MAX_H: f64 = 900.0;

/// 倒计时目标上限（秒）= 24h；超限 `start_countdown` → `INVALID_TARGET_SEC`。
pub const MAX_COUNTDOWN_SEC: i64 = 86400;

/// 后台提醒扫描间隔（秒；查询式扫描，天然抗休眠，ADR-010）。
pub const REMINDER_SCAN_INTERVAL_SECS: u64 = 15;

/// 倒计时到点判定间隔（秒；1s watcher，ADR-011）。
pub const COUNTDOWN_WATCH_INTERVAL_SECS: u64 = 1;

/* settings 键名（schema.sql 尾部登记） */
pub const KEY_AUTOSTART_ENABLED: &str = "autostart.enabled";
pub const KEY_ALWAYS_ON_TOP: &str = "ui.always_on_top";
pub const KEY_OPACITY_ENABLED: &str = "ui.opacity_enabled";
pub const KEY_LAST_DISPLAY_ID: &str = "ui.last_display_id";
pub const KEY_LAST_ITEM_ID: &str = "ui.last_item_id";
pub const KEY_WINDOW_X: &str = "ui.window_x";
pub const KEY_WINDOW_Y: &str = "ui.window_y";
pub const KEY_SHORTCUT_TOGGLE_WINDOW: &str = "shortcut.toggle_window";
pub const KEY_SHORTCUT_START_PAUSE: &str = "shortcut.start_pause";
pub const KEY_SHORTCUT_STOP: &str = "shortcut.stop";
pub const KEY_SHORTCUT_NEW_ITEM: &str = "shortcut.new_item";

/* V0.2.0 新增 settings 键（schema-V0.2.0.sql §第二部分） */
pub const KEY_THEME_MODE: &str = "theme.mode";
pub const KEY_ACCENT_RUNNING: &str = "accent.running";
pub const KEY_ACCENT_WARN: &str = "accent.warn";
pub const KEY_ACCENT_DONE: &str = "accent.done";
pub const KEY_ACCENT_BAR: &str = "accent.bar";
pub const KEY_COUNTDOWN_PRESETS: &str = "countdown.presets";
/// [V0.2.0 批 2] 倒计时到点「自动结束并保存」开关（bool，默认 false = 仅通知 + 视觉提示，AC-62）。
/// 键值表无 DDL，缺省即回落默认（不需要迁移）。
pub const KEY_COUNTDOWN_AUTO_END: &str = "countdown.auto_end";

/* V0.2.0 默认值（**唯一**允许出现色值字面量的位置；组件 / 服务层一律引用此处，禁裸 hex，DTO-05） */
/// 主题模式默认值（"dark" | "light" | "system"）。
pub const DEFAULT_THEME_MODE: &str = "dark";
/// 四色默认值：计时中 / 提醒 / 完成（= 设计令牌 V0.2.0 默认；`bar` 默认 null = 跟随主题）。
pub const DEFAULT_ACCENT_RUNNING: &str = "#4DA3E8";
pub const DEFAULT_ACCENT_WARN: &str = "#E8A33D";
pub const DEFAULT_ACCENT_DONE: &str = "#4CC38A";
/// 倒计时预设默认值（秒，升序）。
pub const DEFAULT_COUNTDOWN_PRESETS: [i64; 6] = [300, 900, 1500, 1800, 2700, 3600];
