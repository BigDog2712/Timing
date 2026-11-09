//! Patina 子系统的宿主侧接线：数据落点 + 首启导入。
//!
//! 为什么单独一个文件：`bootstrap.rs` 正好 300 行（门禁上限），而这段逻辑
//! 又不属于「Patina 上游代码」，放在 `src/patina/` 下会让 vendored 子树与宿主耦合。
//!
//! 两件事，顺序不能换（由 `lib.rs` 的 setup 闭包保证）：
//! 1. **定落点**：Patina 上游按 `%APPDATA%\Patina` 解析数据根——那正是用户已安装的
//!    Patina 的真实目录。融合后必须改到 Timing 自己的根下，否则两个应用同时打开
//!    同一个 sqlite 文件（WAL 抢锁 → 锁超时 / 库损坏）。
//! 2. **首启导入**：目标库不存在时，从 `%APPDATA%\Patina\patina.db` 拷一份过来，
//!    让「已用过 Patina」的用户一进来就看到自己的历史。之后两边各管各的，
//!    同不同步是后续功能，不在这里做。

use std::path::{Path, PathBuf};

/// Patina 子系统在 Timing 数据根下的落点：`<数据根>/patina/{data,webview}`。
pub fn patina_root() -> PathBuf {
    crate::platform::app_dir::data_root().join("patina")
}

/// 上游（独立安装的 Patina）的数据目录。
///
/// 直接用 `dirs` 求 `%APPDATA%`：这里要**故意**绕开 Tauri 的 `app_data_dir()`
/// （那是 Timing 自己的标识符目录），也绕开 Patina 的 profile 逻辑——
/// 我们只要「用户装过的那一份」，认不到就当没有。
fn upstream_data_dir() -> Option<PathBuf> {
    let roaming = dirs::data_dir()?;
    let candidate = roaming.join("Patina");
    candidate.is_dir().then_some(candidate)
}

/// 启动期一次性准备。返回 `Ok(None)` = 本次没导入（不需要 / 没有源）。
///
/// 失败**不阻断启动**：Patina 子系统照常跑，只是历史为空——比整个应用起不来好。
pub fn prepare() -> Result<Option<PathBuf>, String> {
    let root = patina_root();
    let data_dir = root.join("data");
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("创建 {} 失败: {err}", data_dir.display()))?;

    // 落点在创建之后立刻注入：Patina 的 setup 会拿它建库，晚一步就落到 AppData 去了。
    crate::infra::insight::app_paths::set_root_override(root.clone());

    let target = data_dir.join("patina.db");
    if target.exists() {
        return Ok(None);
    }
    let Some(source_dir) = upstream_data_dir() else {
        return Ok(None);
    };
    let source = source_dir.join("patina.db");
    if !source.is_file() {
        return Ok(None);
    }

    copy_database(&source, &target)?;
    crate::log_info!(
        "patina: imported existing data {} -> {}",
        source.display(),
        target.display()
    );
    Ok(Some(target))
}

/// 拷一份 sqlite 库。
///
/// 用 `VACUUM INTO` 而不是文件复制：源库可能正在被独立安装的 Patina 写（WAL 里还有
/// 未落盘的页），直拷 `.db` 会拿到撕裂状态。`VACUUM INTO` 走 sqlite 的一致性读事务，
/// 不需要源库可写。
fn copy_database(source: &Path, target: &Path) -> Result<(), String> {
    let escaped_source = sqlite_url(source)?;
    let escaped_target = target.display().to_string().replace('\'', "''");

    let result = tauri::async_runtime::block_on(async move {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        use std::str::FromStr;

        let options = SqliteConnectOptions::from_str(&escaped_source)
            .map_err(|err| format!("解析源库地址失败: {err}"))?
            .read_only(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|err| format!("打开源库失败: {err}"))?;
        let outcome = sqlx::query(&format!("VACUUM INTO '{escaped_target}'"))
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|err| format!("VACUUM INTO 失败: {err}"));
        pool.close().await;
        outcome
    });

    if let Err(err) = result {
        /* 退路：源库被独占锁住时 `VACUUM INTO` 会失败，此时至少把主库文件搬过去。
        一致性没有保证，所以只在 VACUUM 失败后尝试，并在日志里明说。 */
        crate::log_warn!("patina: VACUUM INTO failed ({err}); falling back to file copy");
        std::fs::copy(source, target)
            .map_err(|copy_err| format!("{err}; 且文件复制也失败: {copy_err}"))?;
    }
    Ok(())
}

/// `sqlite://<绝对路径>?mode=ro`。Windows 的反斜杠在 URL 里会被当转义，统一换正斜杠。
fn sqlite_url(path: &Path) -> Result<String, String> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    Ok(format!("sqlite://{normalized}?mode=ro"))
}

/* ─────────────────────────── 数据互见（读侧） ───────────────────────────
宿主要在自己的统计里显示「同期电脑活动」，就得读 Patina 的活动库。这里只读、
不写、不建表：**写入永远是 Patina 自己的事**，宿主插一脚会跟它的补写/回滚逻辑打架。

为什么另开一条连接而不是复用 Patina 的池：那个池是 `crate::services::insight::data::sqlite_pool` 的
私有状态，借出来等于让宿主代码依赖 vendored 子树的内部实现；而且它是**可写**连接，
一旦被宿主拿去跑查询，将来有人顺手写一条 UPDATE 就绕过了 Patina 的全部不变量。
单开一条 `mode=ro` 的池，物理上就写不进去。 */

/// 活动库连接池：只读、单连接、懒建。
///
/// `OnceCell` 只缓存**成功**的连接（`get_or_try_init`）：库当时还不存在（首次启动
/// Patina 尚未建库）时会在下一次调用重试，而不是永久缓存一个「没有」。
static ACTIVITY_POOL: tokio::sync::OnceCell<sqlx::SqlitePool> = tokio::sync::OnceCell::const_new();

/// `patina.db` 的绝对路径。
fn activity_db_path() -> PathBuf {
    patina_root().join("data").join("patina.db")
}

async fn activity_pool() -> Result<&'static sqlx::SqlitePool, String> {
    ACTIVITY_POOL
        .get_or_try_init(|| async {
            use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

            let path = activity_db_path();
            if !path.is_file() {
                return Err(format!("{} 不存在", path.display()));
            }
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .read_only(true)
                /* Patina 正在写（WAL）时读会被短暂挡住：给 2 秒余量，超时就当本次没数据，
                不能让它把记录面板拖成转圈。 */
                .busy_timeout(std::time::Duration::from_secs(2));
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .map_err(|err| format!("打开 {} 失败: {err}", path.display()))
        })
        .await
}

/// 查询区间是否值得查库（纯函数：空/反向区间直接返回空，不碰数据库）。
fn range_is_queryable(from_ms: i64, to_ms: i64, limit: i64) -> bool {
    to_ms > from_ms && limit > 0
}

/// 活动聚合查询。抽成常量是为了让用例跑**同一条**语句——SQL 里那段裁剪口径是唯一
/// 容易写错的地方，测试另写一份 SQL 就失去意义了。
const ACTIVITY_SQL: &str = "\
    SELECT app_name AS app, \
           exe_name AS exe, \
           CAST(SUM(MIN(end_time, ?2) - MAX(start_time, ?1)) / 1000 AS INTEGER) AS sec, \
           COUNT(*) AS samples \
    FROM sessions \
    WHERE end_time > ?1 AND start_time < ?2 \
    GROUP BY app_name, exe_name \
    ORDER BY sec DESC \
    LIMIT ?3";

/// 区间内的电脑活动，按应用聚合、按秒降序。
///
/// **跨界裁剪**：会话可能横跨查询区间（例如 8:00 就在用编辑器，而区间从 10:00 开始），
/// 所以时长取 `min(end, to) - max(start, from)`，不能直接用 `duration` 列——那是会话原始
/// 时长，会把区间外的部分算进来。
///
/// 失败一律返回空数组：这条数据是**旁证**，拿不到就不显示，绝不能因为它让记录面板报错。
pub async fn activity_summary(
    from_ms: i64,
    to_ms: i64,
    limit: i64,
) -> Vec<crate::models::stats::ActivitySlice> {
    if !range_is_queryable(from_ms, to_ms, limit) {
        return Vec::new();
    }
    let pool = match activity_pool().await {
        Ok(pool) => pool,
        Err(err) => {
            crate::log_warn!("patina: activity summary unavailable: {err}");
            return Vec::new();
        }
    };
    match sqlx::query_as::<_, crate::models::stats::ActivitySlice>(ACTIVITY_SQL)
        .bind(from_ms)
        .bind(to_ms)
        .bind(limit)
        .fetch_all(pool)
        .await
    {
        Ok(rows) => rows.into_iter().filter(|row| row.sec > 0).collect(),
        Err(err) => {
            crate::log_warn!("patina: activity summary query failed: {err}");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn inverted_range_is_rejected_before_touching_the_database() {
        /* 前置判断做成纯函数，才能在**不建库**的情况下钉住「空区间不查库」。
        直接断言 `activity_summary` 返回空是断不出东西的——它对任何错误都返回空。 */
        assert!(!range_is_queryable(10, 5, 10));
        assert!(!range_is_queryable(5, 5, 10));
        assert!(!range_is_queryable(5, 10, 0));
        assert!(range_is_queryable(5, 10, 10));
    }

    /* 真正容易写错的是那段 SQL 的裁剪口径：拿 `duration` 直接求和，在整段查询里看起来
    完全正常，只有**横跨区间边界**的会话会凭空多算。这里用内存库跑同一条语句钉死它：
    会话 10 分钟，区间只覆盖末尾 2 分钟 → 120 秒，而不是 600。 */
    #[tokio::test]
    async fn overlapping_sessions_are_clipped_to_the_range() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::query(
            "CREATE TABLE sessions (
                app_name TEXT NOT NULL, exe_name TEXT NOT NULL,
                start_time INTEGER NOT NULL, end_time INTEGER NOT NULL, duration INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("create table");

        let start = 1_000_000_i64;
        // ① 横跨左边界：0-10 分钟，区间从第 8 分钟开始 → 应计 2 分钟
        insert_session(&pool, "Editor", "editor.exe", start, start + 600_000).await;
        // ② 完全落在区间内：第 8.3 到第 9.3 分钟 → 应计 60 秒
        insert_session(&pool, "Browser", "chrome.exe", start + 500_000, start + 560_000).await;
        // ③ 完全在区间之前：不该出现在结果里
        insert_session(&pool, "Mail", "mail.exe", start - 900_000, start - 600_000).await;

        let from = start + 480_000;
        let to = start + 600_000;
        let rows = sqlx::query_as::<_, crate::models::stats::ActivitySlice>(ACTIVITY_SQL)
            .bind(from)
            .bind(to)
            .bind(10_i64)
            .fetch_all(&pool)
            .await
            .expect("query");

        assert_eq!(rows.len(), 2, "区间外的应用不该出现在结果里");
        assert_eq!(rows[0].app, "Editor");
        assert_eq!(rows[0].sec, 120, "跨界会话必须按区间裁剪，不能拿 duration 求和");
        assert_eq!(rows[0].samples, 1);
        assert_eq!(rows[1].app, "Browser");
        assert_eq!(rows[1].sec, 60, "完全落在区间内的会话按原样计入");
    }

    async fn insert_session(
        pool: &sqlx::SqlitePool,
        app: &str,
        exe: &str,
        start: i64,
        end: i64,
    ) {
        sqlx::query("INSERT INTO sessions (app_name, exe_name, start_time, end_time, duration) VALUES (?, ?, ?, ?, ?)")
            .bind(app)
            .bind(exe)
            .bind(start)
            .bind(end)
            .bind(end - start)
            .execute(pool)
            .await
            .expect("insert session");
    }
}
