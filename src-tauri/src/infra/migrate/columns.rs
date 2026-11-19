//! 迁移加列清单（从 `migrate.rs` 拆出：那个文件在 0.12.3 撞 300 行）。
//!
//! 只放常量与「为什么是这些列」的注释，执行顺序仍在 `migrate()` 里。SQLite 的加列不是
//! 幂等 SQL，列清单必须由 `ensure_column` 读，别把这些数组换成 `ALTER` 字符串。

/// V0.2.0 加列清单 `(表, 列, 定义)`。定义与 `schema-V0.2.0.sql` 目标 DDL 对齐；
/// 旧库经 `ALTER` 补齐后**不带 CHECK**（SQLite 限制），取值由应用层保证（架构 §4.3）。
pub(super) const MIGRATE_COLUMNS: &[(&str, &str, &str)] = &[
    ("items", "remind_at", "INTEGER"),
    ("items", "reminded_at", "INTEGER"),
    ("items", "is_pinned", "INTEGER NOT NULL DEFAULT 0"),
    ("time_records", "mode", "TEXT NOT NULL DEFAULT 'countup'"),
    ("time_records", "target_sec", "INTEGER"),
];

/// V0.3.0 加列清单。**必须晚于 `0002_v020.sql`**（`notes` 表由它创建）。
///
/// `DEFAULT 1` = 置顶：V0.2.x 的便利贴窗口硬编码 `always_on_top=true`，默认 1 让
/// 老数据升级后行为不变（ADR-019）。
pub(super) const MIGRATE_COLUMNS_V3: &[(&str, &str, &str)] =
    &[("notes", "is_pinned", "INTEGER NOT NULL DEFAULT 1")];

/// V0.3.12 加列清单（待办提醒链路，ADR-030）。**必须晚于 `0002_v020.sql`**（`todos` 由它创建）。
///
/// - `remind_stage`：0 未提醒 / 1 轻提醒已弹 / 2 五分钟询问已弹（单调递进，替代单次 `reminded_at`）；
/// - `auto_start`：1 = 用户答应「当前事项结束后自动开始」。
pub(super) const MIGRATE_COLUMNS_V4: &[(&str, &str, &str)] = &[
    ("todos", "remind_stage", "INTEGER NOT NULL DEFAULT 0"),
    ("todos", "auto_start", "INTEGER NOT NULL DEFAULT 0"),
];

/// V0.11.3 加列清单：待办绑定事项。
///
/// 可空 —— 老数据不回填（回填等于重跑一次标题匹配，同名待办会被绑成一条），
/// 新建时也不强制选事项。空值由 `todo_start` 兜底并回填，见 `services::todo_start`。
pub(super) const MIGRATE_COLUMNS_V5: &[(&str, &str, &str)] = &[("todos", "item_id", "INTEGER")];

/// 0.12.2 加列清单（设备维度）。
///
/// `device_id` 的 `DEFAULT ''` 是**迁移期哨兵**，由 `services::device` 在启动时改写成
/// 真实 `install_id`。用 `''` 而不是方案书写的 `'local'`：`'local'` 会与「本机 id 就叫
/// local」混淆，而空串在所有 `CHECK(TRIM(device_id) <> '')` 之外的地方都能被自然忽略。
///
/// 走 `ensure_column`（`PRAGMA table_info` 守卫）而不是裸 `ALTER`：SQLite 没有
/// `ADD COLUMN IF NOT EXISTS`，而本函数每次启动都会跑（K-13）。
pub(super) const MIGRATE_COLUMNS_V9: &[(&str, &str, &str)] = &[
    ("time_records", "device_id", "TEXT NOT NULL DEFAULT ''"),
    ("time_records", "uid", "TEXT"),
    ("time_records", "merged_into_uid", "TEXT"),
];

/// 0.12.2 加列清单（同步簿记）。
///
/// 只负责「列在不在」：盖戳由 `0010_v0141_sync_bookkeeping_guard.sql` 里的触发器做
/// （不能依赖调用点记得写——写入口有四个，漏一个就是「那批行永远不会被导出且零报错」）。
pub(super) const MIGRATE_COLUMNS_V10: &[(&str, &str, &str)] = &[(
    "time_records",
    "updated_at_ms",
    "INTEGER NOT NULL DEFAULT 0",
)];

/// 0.13.x 加列清单（事项归属）。
///
/// `parent_id` / `depth` / `category_key` 是「事项升为主数据」的三件：树、深度、分类。
/// 深度硬限 2 层由应用层守（`depth <= 1`），不写成 CHECK：ALTER 加的列在 SQLite 上
/// 带不了 CHECK，而新库的 DDL 与旧库的列定义一旦不一致，就会出现「新库拦得住、
/// 旧库拦不住」的分裂——取值合法性统一由 `services::item` 保证。
///
/// `device_id` 的 `DEFAULT ''` 与 `time_records` 同义（迁移期哨兵），由
/// `services::device::startup_business_identity` 认领。
pub(super) const MIGRATE_COLUMNS_V11: &[(&str, &str, &str)] = &[
    ("items", "parent_id", "INTEGER"),
    ("items", "depth", "INTEGER NOT NULL DEFAULT 0"),
    ("items", "category_key", "TEXT"),
    ("items", "device_id", "TEXT NOT NULL DEFAULT ''"),
    ("items", "uid", "TEXT"),
    ("items", "updated_at_ms", "INTEGER NOT NULL DEFAULT 0"),
];

/// 0.12.3 加列清单（事项多标签）。
///
/// `tags` 是 JSON 数组，元素就是 Obsidian 风格标签路径（`学习/考公`）。放单列而不是
/// 关联表：事项本来就按行走全额数据包（动态列合并），加列即跨端可用（见 0017 SQL 的取舍说明）。
///
/// 与 0009–0011 同型：列由 `PRAGMA` 守卫补（K-13），触发器幂等段每次启动跑，
/// 版本推进关在 `< 17` 版本门里。
pub(super) const MIGRATE_COLUMNS_V17: &[(&str, &str, &str)] =
    &[("items", "tags", "TEXT NOT NULL DEFAULT '[]'")];
