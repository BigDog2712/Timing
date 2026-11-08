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

    /* V2 + V3：完整性与行数。临时库是我们自己的副本，正常读写打开
    （只读打开在「-wal 需要恢复」时会失败，而恢复正好是我们想让它做的）。 */
    let facts = block_on_detached(inspect_db(db))?;
    if facts.integrity != "ok" {
        return Err(format!("integrity_check 未通过：{}", facts.integrity));
    }
    if facts.schema_version.is_none() {
        return Err("校验失败：settings.schema.version 不可读".to_string());
    }

    /* V4 与源库比对行数。**不直接打开源库**：SQLite 对 WAL 库即使
    `SQLITE_OPEN_READONLY` 也必须在库文件旁边落地 `-shm`（32 KB）与 `-wal`，
    而「旧目录一个字节都不改」是迁移的硬承诺（ADR-050 §4）——这句话以前是假的
    （QA 复现：迁移后源目录多出 `timing.db-shm` / `timing.db-wal`）。
    做法：把源库连同 `-wal` / `-shm` **复制一份**到影子目录，在影子库上开库比对，
    比完删影子。源目录只剩读文件/读元数据两类系统调用。 */
    let src_db = if source.join(LEGACY_DB_NAME).exists() {
        source.join(LEGACY_DB_NAME)
    } else {
        source.join(DB_NAME)
    };
    if src_db.exists() {
        match shadow_facts(&src_db, temp) {
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
                /* 影子副本都读不出来（源库损坏 / 权限不足）：降级为「不比行数」，
                 **不判失败**。V1~V3 已经在副本上验过完整性，这里只是加分项。 */
            }
        }
    }

    Ok(facts.counts)
}

/// 在**影子副本**上读源库事实（源目录一个字节都不碰）。
///
/// 为什么不在源库上用 `immutable=1`：那是「我保证这文件不会被改」的承诺，
/// 而我们并不能保证（用户可能正开着旧版应用）；影子副本没有这个前提依赖。
fn shadow_facts(src_db: &Path, temp: &Path) -> Result<DbFacts, String> {
    let mut dir_name = temp.as_os_str().to_os_string();
    dir_name.push(".v4-src");
    let dir = PathBuf::from(dir_name);

    /* 上一次被强杀可能留下影子目录：它是我们自己的中间产物，可以直接清。
    **清不掉就不能往下走** —— `create_dir_all` 对已存在的目录是静默成功，接着
    `fill_shadow` 会往一个脏目录里复制：源里没有 `-wal`、残留里却有，SQLite 就会拿
    那个陈旧 WAL 回放，行数比对随即得出一个与本次迁移无关的结论。Windows 上
    `remove_dir_all` 失败通常是杀软/索引器短暂持有句柄，属于「这一次不查」，不是失败。 */
    if let Err(err) = std::fs::remove_dir_all(&dir) {
        if dir.exists() {
            return Err(format!(
                "影子目录 {} 清理不掉（{err}），跳过行数比对",
                dir.display()
            ));
        }
    }
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("建影子目录 {} 失败：{err}", dir.display()))?;

    /* 建好之后必须是空的：上面那句 `remove_dir_all` 与这里之间可能被别的进程塞进东西
    （同一个 target 被并发搬两次），脏目录一律不查，理由同上。 */
    let dirty = std::fs::read_dir(&dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(true);
    if dirty {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(format!("影子目录 {} 非空，跳过行数比对", dir.display()));
    }

    /* 目录已建好之后**每一步失败都要清掉它**，否则磁盘满 / 目标盘只读时会在数据盘
    上留一个 `<target>.migrating.v4-src`（用户永远不知道该不该删）。所以填充与分析
    拆到 `fill_shadow` 里，统一在出口清理。 */
    let result = fill_shadow(src_db, &dir);
    /* 出口清理失败**不改变校验结论**（副本已经读完），但必须留痕：残留的影子目录正是
    下一次「读到脏目录」的源头，`let _ =` 静默吞掉等于把问题藏起来。 */
    if let Err(err) = std::fs::remove_dir_all(&dir) {
        crate::log_warn!("shadow: 清理影子目录 {} 失败：{err}", dir.display());
    }
    result
}

/// 把源库（含 `-wal` / `-shm`）复制进影子目录并开库读事实。
fn fill_shadow(src_db: &Path, dir: &Path) -> Result<DbFacts, String> {
    let name = src_db
        .file_name()
        .ok_or_else(|| format!("源库路径没有文件名：{}", src_db.display()))?;
    /* `-wal` / `-shm` 一起复制：只复制主库会让「尚未 checkpoint 的事务」凭空消失，
    行数比对就会拿一个更老的快照去比，误判成「行数不一致」。 */
    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", src_db.display()));
        if from.is_file() {
            let to = dir.join(format!("{}{suffix}", name.to_string_lossy()));
            std::fs::copy(&from, &to)
                .map_err(|err| format!("复制源库到影子目录失败（{}）：{err}", from.display()))?;
        }
    }
    block_on_detached(inspect_db(dir.join(name)))
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
///
/// **没有 `read_only` 开关，是有意的**：只读打开 SQLite 仍会在库文件旁边落地
/// `-shm` / `-wal`（V0.11.6 的 QA 实测：源目录多出 32 KB 的 `timing.db-shm`），
/// 而迁移承诺「旧目录一个字节都不改」。所以本模块只在**自己的副本**上开库
/// （临时副本 / `shadow_facts` 的影子副本），永远不需要只读模式——留一个恒为
/// `false` 的开关只会让下一个人以为存在一条只读路径（正是 V0.11.6 踩过的坑）。
async fn inspect_db(path: PathBuf) -> Result<DbFacts, String> {
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(false);
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
