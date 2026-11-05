//! 四重校验：逐文件字节数 / `PRAGMA integrity_check` / 五表行数 / 版本键可读。
//!
//! 为什么校验要开库而迁移模块是 headless：项目的数据访问统一走 `sqlx`（ADR-015），
//! 校验也必须用同一个驱动（不然「校验用的解析器」和「真正读库的解析器」不是一套）。
//! `sqlx` 是 async 的，而迁移跑在 `Builder::run()` 之前、主线程上——所以这里把
//! **一次性的校验任务丢到一个独立线程**去跑（线程内自建 runtime）。
//!
//! 为什么不是「就地建 runtime + block_on」：`cargo test` 的用例本身在 tokio 运行时里，
//! 就地再建一个 runtime 会 panic（`Cannot start a runtime from within a runtime`）。
//! 换线程后两种调用场景（`run()` 主线程 / 测试异步上下文）走的是同一条代码路径。

use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::copy::map_name;
use super::paths::{DB_NAME, LEGACY_DB_NAME};
use crate::models::migration::RowCounts;

/// 单次开库得到的校验事实。
struct DbFacts {
    integrity: String,
    counts: RowCounts,
    schema_version: Option<String>,
}

/// 校验临时目录里的迁移结果，返回五表行数（供标记文件与日志使用）。
pub fn verify(temp: &Path, source: &Path) -> Result<RowCounts, String> {
    /* V1 逐文件字节数：先做最便宜的一层，能挡住绝大多数半截复制。 */
    compare_dir(source, temp)?;

    let db = temp.join(DB_NAME);
    if !db.exists() {
        /* M-13：旧目录只有一个空 `logs/`（没有库）。复制完日志后正常空库启动，
        不校验、不弹失败框。 */
        return Ok(RowCounts::default());
    }

    /* V2 + V3：完整性与行数。临时库是我们自己的副本，可读写打开
    （只读打开在「-wal 需要恢复」时会失败，而恢复正好是我们想让它做的）。 */
    let facts = block_on_detached(inspect_db(db, false))?;
    if facts.integrity != "ok" {
        return Err(format!("integrity_check 未通过：{}", facts.integrity));
    }
    if facts.schema_version.is_none() {
        return Err("校验失败：settings.schema.version 不可读".to_string());
    }

    /* V4 与源库比对行数。源库**只读**打开，且失败即跳过：WAL 里若有未 checkpoint
    的事务，只读连接可能报 `SQLITE_READONLY_RECOVERY`——这不是迁移出错，
    只是我们不该为了校验去改用户的老库。 */
    let src_db = if source.join(LEGACY_DB_NAME).exists() {
        source.join(LEGACY_DB_NAME)
    } else {
        source.join(DB_NAME)
    };
    if src_db.exists() {
        match block_on_detached(inspect_db(src_db, true)) {
            Ok(src) => {
                if src.counts != facts.counts {
                    return Err(format!(
                        "行数不一致：源 {} / 新 {}",
                        src.counts.summary(),
                        facts.counts.summary()
                    ));
                }
            }
            Err(_err) => {
                /* 只读打开失败（多为 WAL 里有未 checkpoint 的事务 → `SQLITE_READONLY_RECOVERY`）：
                降级为「不比行数」，**不判失败**。我们不该为了校验去改用户的老库。 */
            }
        }
    }

    Ok(facts.counts)
}

/// V1：逐文件比较字节数（目录结构必须一一对应）。
fn compare_dir(from: &Path, to: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(from)
        .map_err(|err| format!("读源目录 {} 失败：{err}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读源目录项失败：{err}"))?;
        let src = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let dst = to.join(map_name(&name));
        let Ok(meta) = std::fs::metadata(&src) else {
            /* 与 copy.rs 同规则：悬空链接在复制阶段被跳过，校验阶段也跳过。 */
            continue;
        };
        if meta.is_dir() {
            if !dst.is_dir() {
                return Err(format!("缺少目录 {}", dst.display()));
            }
            compare_dir(&src, &dst)?;
            continue;
        }
        let got = std::fs::metadata(&dst)
            .map(|m| m.len())
            .map_err(|_| format!("缺少文件 {}", dst.display()))?;
        if got != meta.len() {
            return Err(format!(
                "字节数不一致 {}：源 {} / 新 {}",
                name,
                meta.len(),
                got
            ));
        }
    }
    Ok(())
}

/// 开库读三类事实：完整性、五表行数、`settings.schema.version`。
async fn inspect_db(path: PathBuf, read_only: bool) -> Result<DbFacts, String> {
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(false)
        .read_only(read_only);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|err| format!("打开 {} 失败：{err}", path.display()))?;

    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&pool)
        .await
        .map_err(|err| format!("integrity_check 执行失败：{err}"))?;

    let counts = RowCounts {
        items: count(&pool, "items").await?,
        time_records: count(&pool, "time_records").await?,
        todos: count(&pool, "todos").await?,
        notes: count(&pool, "notes").await?,
        settings: count(&pool, "settings").await?,
    };

    let schema_version: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'schema.version'")
            .fetch_optional(&pool)
            .await
            .map_err(|err| format!("读 schema.version 失败：{err}"))?;

    let _ = pool.close().await;
    Ok(DbFacts {
        integrity,
        counts,
        schema_version,
    })
}

/// 单表行数。表名来自本文件的常量集合，不接受外部输入（无注入面）。
async fn count(pool: &SqlitePool, table: &str) -> Result<i64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    sqlx::query_scalar::<_, i64>(&sql)
        .fetch_one(pool)
        .await
        .map_err(|err| format!("统计 {table} 失败：{err}"))
}

/// 在**独立线程**里跑一段 async 代码（线程内自建 runtime，用完即关）。
fn block_on_detached<F, T>(future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>> + Send + 'static,
    T: Send + 'static,
{
    let handle = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .map_err(|err| format!("创建校验运行时失败：{err}"))?;
        let out = runtime.block_on(future);
        /* 不阻塞等后台任务收尾：连接池已在 `inspect_db` 里 close 过，
        残留的只是线程退出前的清理。 */
        runtime.shutdown_background();
        out
    });
    match handle.join() {
        Ok(result) => result,
        Err(_) => Err("校验线程异常退出".to_string()),
    }
}
