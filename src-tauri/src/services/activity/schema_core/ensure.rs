//! 幂等建表 / 升级内核：把**任何**状态的库带到 head 28。
//!
//! 入参只有 `&Pool<Sqlite>`，零 `AppHandle`/`tauri::`——这样手机端一条宿主命令就能建库，
//! 不必把整个 `services::activity::data` 搬进移动端编译面（裁决 B）。
//!
//! ## 两步的顺序是硬约束
//!
//! 1. **先**跑 Migrator（空库要靠它建 `sessions`）；
//! 2. **再**跑补列守卫（老库上 `_sqlx_migrations` 已到 28、Migrator 什么都不做，
//!    靠守卫修复「被人手工删过列」的库）。
//!
//! 反过来：空库上先补列会 `no such table`。
//!
//! ## 为什么可以直接用 `data::schema_registry`
//!
//! 历史 1–27 的 DDL 正文在 `data/schema.rs` 的常量里（checksum 已进用户账本，动不得）。
//! 内核要跑完整迁移就必须读到它们；而 `schema.rs` 只是 SQL 字符串 + 纯函数，不含 Win32。
//! 真正不可移植的是 `data/**` 里引用 `infra::insight` 的那一片，本内核一个都不碰。

use crate::services::activity::data::schema::Migration;
use crate::services::activity::data::schema_registry;
use futures_util::future::BoxFuture;
use sqlx::error::BoxDynError;
use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
use sqlx::{Pool, Row, Sqlite};
use std::path::Path;

/// `sessions` 在设备维度里新增的**普通**列（生成列 `app_key` 不在此列，见下）。
///
/// 定义与 `data/sql/0028_device_dimension.sql` ② 逐字一致；这里只是「被人手工删过列」
/// 的兜底修复路径，不是主路径（主路径永远是迁移本身）。
const DEVICE_COLUMNS: &[(&str, &str)] = &[
    ("device_id", "TEXT NOT NULL DEFAULT ''"),
    ("uid", "TEXT"),
    ("updated_at_ms", "INTEGER NOT NULL DEFAULT 0"),
    ("synced_seq", "INTEGER"),
];

/// 给 sqlx 的 `Migrator` 喂一份内存里的迁移表（不读目录、不需要 `migrations/`）。
#[derive(Debug)]
struct PortableMigrationList(Vec<Migration>);

impl MigrationSource<'static> for PortableMigrationList {
    fn resolve(self) -> BoxFuture<'static, Result<Vec<SqlxMigration>, BoxDynError>> {
        Box::pin(async move {
            let mut migrations = Vec::new();
            for migration in self.0 {
                migrations.push(SqlxMigration::new(
                    migration.version,
                    migration.description.into(),
                    MigrationType::ReversibleUp,
                    migration.sql.into(),
                    false,
                ));
            }
            Ok(migrations)
        })
    }
}

/// 把库带到 head 28：跑一遍 Migrator，再补齐设备维度的列。
///
/// `db_path` 只用于**报错**：迁移失败时必须写出用户能照着去找的那个真实路径。
pub async fn ensure_schema_at(pool: &Pool<Sqlite>, db_path: &Path) -> Result<(), String> {
    let migrator = Migrator::new(PortableMigrationList(schema_registry::tracker_migrations()))
        .await
        .map_err(|error| format!("failed to prepare sqlite migrations: {error}"))?;
    migrator
        .run(pool)
        .await
        .map_err(|error| describe_migration_failure(&error, db_path))?;
    ensure_device_columns(pool).await
}

/// 测试用：只包含 `<= version` 的迁移（模拟「旧版本的 Timing 打开被升级过的库」）。
#[cfg(test)]
pub(super) async fn migrator_up_to(version: i64) -> Result<Migrator, String> {
    let migrations = schema_registry::tracker_migrations()
        .into_iter()
        .filter(|migration| migration.version <= version)
        .collect();
    Migrator::new(PortableMigrationList(migrations))
        .await
        .map_err(|error| error.to_string())
}

/// 把 sqlx 的 `MigrateError` 翻成用户能读的中文（裁决 2：英文报错等于「报错不可读」）。
///
/// 两条分支各自对应一个**真实会遇到的**场景：
/// - `VersionMissing`：老版本的 Timing 打开被新版本升级过的库。老版本的迁移表只到 27，
///   而账本里有 28 → sqlx 报「previously applied but is missing in the resolved migrations」。
///   用户看到的必须是「装回新版本或从备份恢复」，而不是这句话。
/// - `VersionMismatch`：账本里某条迁移的校验和与当前 DDL 不一致（混装两个版本、或有人改过
///   已发布迁移的正文）。这时**不做**自动修账本，只把路径和出口写清楚。
pub fn describe_migration_failure(error: &sqlx::migrate::MigrateError, db_path: &Path) -> String {
    let location = format!("（数据目录：{}）", db_path.display());
    match error {
        sqlx::migrate::MigrateError::VersionMissing(version) => format!(
            "此数据目录已被更新版本的 Timing 使用过（库里记着迁移 {version}，当前版本不认识它）             {location}。请装回新版本的 Timing，或从 backups 恢复一份旧库。"
        ),
        sqlx::migrate::MigrateError::VersionMismatch(version) => format!(
            "数据库里的迁移 {version} 的校验和与当前版本不一致{location}——通常意味着混装了             两个版本的 Timing。请统一到同一版本，或用 backups 恢复。"
        ),
        other => format!(
            "数据库迁移失败{location}：{other}。若反复失败，请从 backups 恢复一份最近的库。"
        ),
    }
}

/// 补设备维度的普通列（`PRAGMA table_info` 守卫；SQLite 没有 `ADD COLUMN IF NOT EXISTS`）。
///
/// **不**补 `app_key`：它是生成列，`ALTER` 里必须内联整段表达式。把那段表达式抄到 Rust
/// 里就等于再造一份「两处必须同时改」的纪律债（裁决 C 明确否掉这条），所以宁可让缺列的库
/// 在启动验收时**明确报错**（`has_current_baseline_layout` 检查 app_key 存在），
/// 也不在两处维护同一段归一逻辑。
async fn ensure_device_columns(pool: &Pool<Sqlite>) -> Result<(), String> {
    for (column, definition) in DEVICE_COLUMNS {
        if sessions_has_column(pool, column).await? {
            continue;
        }
        let sql = format!("ALTER TABLE sessions ADD COLUMN {column} {definition}");
        sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|error| format!("failed to add sessions.{column}: {error}"))?;
        crate::log_info!("added missing sqlite column sessions.{column}");
    }
    Ok(())
}

async fn sessions_has_column(pool: &Pool<Sqlite>, column_name: &str) -> Result<bool, String> {
    sqlx::query("PRAGMA table_info(sessions)")
        .fetch_all(pool)
        .await
        .map(|rows| {
            rows.iter()
                .any(|row| row.get::<String, _>("name") == column_name)
        })
        .map_err(|error| format!("failed to inspect sessions columns: {error}"))
}

/// 把迁移期哨兵 `device_id = ''` 改写成真实 `install_id`，并补齐 `uid`（`patina.db` 的
/// `sessions`）。
///
/// 每次启动都跑，代价是「命中 0 行」（SQLite 在无匹配行时不写 WAL）。
pub async fn adopt_local_rows(pool: &Pool<Sqlite>, device_id: &str) -> Result<u64, String> {
    adopt_rows(pool, "sessions", "s:", device_id).await
}

/// 业务库里**全部带 `uid` 语义的四张表**与各自的 `uid` 前缀（设计 §3.4：`timing.db`
/// 也要认领）。
///
/// 这张表必须是**本文件里的字面量**：`table` / `prefix` 一旦能由外部传入，`UPDATE {table}`
/// 就成了运行时可拼接的 SQL，而「哪张表配哪个前缀」也会变成只有跑起来才知道的事
/// （前缀写错不会报错，只会让那批行的 uid 与触发器的口径不一致、同步时两边对不上）。
///
/// 为什么只有这四张：
/// · 它们的建表 / 加列里都有 `device_id` + `uid` + 触发器（`migrations/0011…`、
///   `migrations/0009…` 的 `trg_*_uid`），也就是「一行只有一个属主」的设备维度；
/// · `notes` / `todos` / `settings` / `app_usage*` **没有 `uid` 列**，不在设备维度里
///   —— 不给它们造一个 `uid` 是刻意的（那是新功能，不是修数据）。
///
/// 顺序无关（各表互相独立，`adopt_rows` 每次都是独立的事务语句）。
const BUSINESS_UID_ADOPTIONS: &[(&str, &str)] = &[
    ("items", "i:"),
    ("time_records", "t:"),
    ("item_app", "b:"),
    ("timer_ops", "p:"),
];

/// 同一件事，做在业务库那**四张带 uid 的表**上：把迁移期哨兵 `device_id = ''` 认领到
/// 本机，并让库补出 `uid`（表清单见 [`BUSINESS_UID_ADOPTIONS`]）。
///
/// 为什么要遍历整表而不是只认领 `time_records`：漏一张表**不会报任何错**。表现是那张表
/// 的历史行 `uid` 恒 NULL（触发器的 `WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''`
/// 在 `device_id` 为空串时不成立）⇒ 那些行永不导出、永不参与跨设备同步。真机上
/// `items` 的 22 行就是这么静默丢了身份的。
///
/// 返回四张表认领到的行数之和；**任何一张表失败都立刻 `?` 冒泡**，不吞错：认领失败
/// 意味着那批行还是没有属主，装作成功只会把问题推迟到「同步时少了一半数据」。
pub async fn adopt_business_rows(pool: &Pool<Sqlite>, device_id: &str) -> Result<u64, String> {
    let mut adopted = 0_u64;
    for &(table, prefix) in BUSINESS_UID_ADOPTIONS {
        adopted += adopt_rows(pool, table, prefix, device_id).await?;
    }
    Ok(adopted)
}

/// 认领 + 补 `uid` 的共用实现。`table` / `prefix` 只接受本文件里的字面量。
///
/// ⚠️ `uid` 回填前**先查重**：`uq_sessions_uid` / `uq_time_records_uid` / `uq_items_uid` /
/// `uq_item_app_uid` / `uq_timer_ops_uid` 都是部分唯一索引，一旦某条
/// 待回填的 `<前缀>||device_id||':'||id` 撞上库里已有的 uid（手工改过库的历史脏数据），
/// 整条 UPDATE 会因唯一约束失败、启动直接挂。有冲突就**不写**、只 WARN，留人工处理
/// —— 静默跳过是更坏的选择（那会让行永远没有 uid，P4 的分片里就少这一行）。
async fn adopt_rows(
    pool: &Pool<Sqlite>,
    table: &str,
    prefix: &str,
    device_id: &str,
) -> Result<u64, String> {
    if !crate::services::identity::is_valid(device_id) {
        return Err(format!(
            "refusing to adopt local rows with an invalid device id `{device_id}`"
        ));
    }
    let adopt_sql = format!("UPDATE {table} SET device_id = ?1 WHERE device_id = ''");
    let adopted = sqlx::query(&adopt_sql)
        .bind(device_id)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to adopt local {table} device id: {error}"))?
        .rows_affected();

    let collision_sql = format!(
        "SELECT COUNT(*) FROM (
             SELECT '{prefix}' || device_id || ':' || id AS candidate
             FROM {table} WHERE uid IS NULL
             INTERSECT
             SELECT uid FROM {table} WHERE uid IS NOT NULL
         )"
    );
    let collisions: i64 = sqlx::query_scalar(&collision_sql)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("failed to check {table} uid collisions: {error}"))?;
    if collisions > 0 {
        crate::log_warn!(
            "skipped {table}.uid backfill: {collisions} candidate uid(s) already exist and need manual repair"
        );
        return Ok(adopted);
    }

    let backfill_sql = format!(
        "UPDATE {table} SET uid = '{prefix}' || device_id || ':' || id WHERE uid IS NULL"
    );
    sqlx::query(&backfill_sql)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to backfill {table} uid: {error}"))?;

    Ok(adopted)
}
