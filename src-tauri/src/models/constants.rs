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

/// 事项名称最大长度（字符）。
///
/// [V0.3.0] 此前**只有前端**限制（`ItemPicker` / `InlineNameEntry` 的 `maxLength=60`），
/// 后端不校验 —— 绕过 UI 直接调 IPC 可以存进任意长的名字，而托盘菜单会按显示宽度
/// 截断（`infra/tray_menu.rs`），数据与展示就此不一致。此处补上后端同值校验，
/// 超长 → `ITEM_NAME_TOO_LONG`（ADR-018）。
pub const ITEM_NAME_MAX_LEN: usize = 60;

/// [V0.4.0] Markdown 同步轮询间隔（秒）。文件监听在 Windows 上要额外依赖 + 处理
/// 编辑器「先写临时文件再替换」的原子写，轮询 2s 足够便宜也足够跟手。
pub const MD_SYNC_POLL_SECS: u64 = 2;

/// 待办标题最大长度（字符，schema-V0.2.0 §todos.title / domain-v020.ts:100「长度 1-200」）。
pub const TODO_TITLE_MAX_LEN: usize = 200;

/// 便利贴正文最大长度（字符，schema-V0.2.0 §notes.content）。
pub const NOTE_CONTENT_MAX_LEN: usize = 4000;

/// 运行中落盘间隔（秒）。崩溃丢失 ≤ 2 个间隔（≤30s）。
pub const FLUSH_INTERVAL_SECS: u64 = 15;

/// 倒计时预设上限（个）。
pub const COUNTDOWN_PRESETS_MAX: usize = 8;

/* V0.3.9 常用摸鱼（应用内置预设）+ 常用事项框偏好 */
/// 常用摸鱼条目上限（个）。超出按顺序截断，避免菜单无限长。
pub const MOYU_PRESET_MAX: usize = 20;
/// 常用摸鱼名称最大长度（字符，与 `MoyuCustom` 输入框 maxLength 一致）。
pub const MOYU_PRESET_NAME_MAX_LEN: usize = 40;
/// 摸鱼时长下限（分钟，与前端 `MOYU_MIN_MINUTES` 同值）。
pub const MOYU_MIN_MINUTES: i64 = 1;
/// 摸鱼时长上限（分钟）= 24h，与 `MAX_COUNTDOWN_SEC` 对齐。
pub const MOYU_MAX_MINUTES: i64 = MAX_COUNTDOWN_SEC / 60;
/// 常用事项框「最近编辑」条数范围与默认值。
pub const RECENT_ITEMS_MIN: i64 = 1;
pub const RECENT_ITEMS_MAX: i64 = 10;
pub const RECENT_ITEMS_DEFAULT: i64 = 5;
/// [V0.3.9] 常用事项的「默认倒计时」时长范围（分钟）：
/// 设了就点它起倒计时，没设就是正计时。上限同样对齐 24h。
pub const ITEM_TIMER_MIN_MINUTES: i64 = 1;
pub const ITEM_TIMER_MAX_MINUTES: i64 = MAX_COUNTDOWN_SEC / 60;

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

/// 待办「轻提醒」提前量（毫秒）：开始前 15 分钟 —— 浮出卡问「要不要改时间」（V0.3.12）。
pub const TODO_LIGHT_LEAD_MS: i64 = 15 * 60 * 1000;

/// 待办「自动开始」询问提前量（毫秒）：开始前 5 分钟 —— 问「当前结束后自动开始？」。
pub const TODO_START_LEAD_MS: i64 = 5 * 60 * 1000;

/// 待办提醒的过期宽限（毫秒）：到点后超过这个时长就不再补弹。
///
/// 关机 / 休眠一晚上后，昨天的待办不该在启动瞬间连着弹两条提醒，更不该自动开始计时；
/// 超过宽限的直接标成「已处理」（stage=2）并静默跳过（`todo_nudge::expire`）。
pub const TODO_NUDGE_GRACE_MS: i64 = 10 * 60 * 1000;

/// 倒计时到点判定间隔（秒；1s watcher，ADR-011）。
pub const COUNTDOWN_WATCH_INTERVAL_SECS: u64 = 1;

/* settings 键名（schema.sql 尾部登记）
[V0.3.3] 下架的键：`ui.always_on_top`（窗口恒定置顶）、`ui.opacity_enabled`（感知壁纸）、
`shortcut.*` 四键（全局快捷键）。常量一并删除——数据库里残留的行没人再读即无害，
历史迁移文件不改（ADR-022）。 */
pub const KEY_AUTOSTART_ENABLED: &str = "autostart.enabled";
pub const KEY_LAST_DISPLAY_ID: &str = "ui.last_display_id";
pub const KEY_LAST_ITEM_ID: &str = "ui.last_item_id";
pub const KEY_WINDOW_X: &str = "ui.window_x";
pub const KEY_WINDOW_Y: &str = "ui.window_y";

/* V0.2.0 新增 settings 键（schema-V0.2.0.sql §第二部分） */
pub const KEY_THEME_MODE: &str = "theme.mode";
pub const KEY_ACCENT_RUNNING: &str = "accent.running";
pub const KEY_ACCENT_WARN: &str = "accent.warn";
pub const KEY_ACCENT_DONE: &str = "accent.done";
pub const KEY_ACCENT_BAR: &str = "accent.bar";
pub const KEY_COUNTDOWN_PRESETS: &str = "countdown.presets";
/* V0.3.9 常用摸鱼 / 常用事项框偏好（均为 settings KV，JSON 或标量） */
pub const KEY_MOYU_PRESETS: &str = "moyu.presets";
pub const KEY_ITEMS_SHOW_RECENT: &str = "items.show_recent";
pub const KEY_ITEMS_RECENT_COUNT: &str = "items.recent_count";
/// [V0.3.9] 常用事项的默认倒计时时长：JSON 对象 `{ "<itemId>": 分钟 }`。
/// 不建表——它只是「这个事项点下去要多长时间」的偏好，跟 is_pinned / sort_order 一样属于 UI 偏好，
/// 事项被删后残留的 key 在读取时按无效值丢弃，无需级联清理。
pub const KEY_ITEMS_TIMERS: &str = "items.timers";
/* [V0.3.4] 原 `KEY_COUNTDOWN_AUTO_END = "countdown.auto_end"` 已删除：
倒计时到点恒结束并保存，不再有开关（ADR-023）。历史库里那一行只读不删。 */

/* V0.2.0 默认值（**唯一**允许出现色值字面量的位置；组件 / 服务层一律引用此处，禁裸 hex，DTO-05） */
/// 主题模式默认值（"dark" | "light" | "system"）。
pub const DEFAULT_THEME_MODE: &str = "dark";
/// 四色默认值：计时中 / 提醒 / 完成（= 设计令牌 V0.2.0 默认；`bar` 默认 null = 跟随主题）。
pub const DEFAULT_ACCENT_RUNNING: &str = "#4DA3E8";
pub const DEFAULT_ACCENT_WARN: &str = "#E8A33D";
pub const DEFAULT_ACCENT_DONE: &str = "#4CC38A";
/// 倒计时预设默认值（秒，升序）。
pub const DEFAULT_COUNTDOWN_PRESETS: [i64; 6] = [300, 900, 1500, 1800, 2700, 3600];
