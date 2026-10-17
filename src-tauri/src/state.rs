//! 应用共享状态（Tauri `manage` 注入）。

use sqlx::SqlitePool;

/// 全局状态：仅持有 SQLite 连接池（业务状态一律落库，不做内存缓存）。
pub struct AppState {
    pub pool: SqlitePool,
}

impl AppState {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}
