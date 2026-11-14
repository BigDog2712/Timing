//! 活动库（`<数据根>/patina/data/patina.db`）的搬迁复制。
//!
//! 为什么单独一个文件：`transfer.rs` 已经贴着 300 行门禁，而这半场是整份清单里唯一
//! 「被搬的库正被另一个子系统写着」的一项，复制方式与其余五项不同，硬塞进那个循环里
//! 只会让「普通目录拷贝」和「活库拷贝」混成一段谁也读不懂的代码。
//!
//! ## 为什么不能按普通目录拷
//!
//! `copy_all` 是**运行时命令**触发的（设置页「确认复制并切换」），那一刻分析窗开着、
//! 活动库的池也开着，写者随时可能落一页进 `-wal`。`transfer.rs` 模块头那条论证
//! （主文件与 `-wal` 是两个时刻的快照，直接拷得到一份**可能撕裂**的库）对活动库一字
//! 不差地成立，所以这里同样走 `VACUUM INTO`：一致性读事务、产物单文件、无 WAL。
//!
//! 与业务库唯一的差别是**池从哪来**：`timing.db` 的池由调用方拿着，这里得自己开一条。
//! 用 read-write 而不是 `read_only`——`VACUUM` 在 `SQLITE_OPEN_READONLY` 上还要依赖
//! 库里的状态标志，不值得赌；同进程已有一条写者也不冲突（WAL 下读者不阻塞写者）。

use std::fs;
use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

/// 活动库的文件名。
pub(super) const DB_FILE: &str = "patina.db";
/// 同一份库的伴生文件：它们必须和主文件**同一个时刻**，单独搬过去只会得到撕裂状态。
const SIDECARS: [&str; 3] = ["patina.db-wal", "patina.db-shm", "patina.db-journal"];

/// 复制 `<source>`（= `patina/data`）整个目录到 `<dest>`，返回搬过去的字节数。
pub(super) async fn copy_activity_dir(source: &Path, dest: &Path) -> Result<u64, String> {
    fs::create_dir_all(dest).map_err(|err| format!("建不了 {}：{err}", dest.display()))?;
    let from_db = source.join(DB_FILE);
    if !from_db.is_file() {
        /* 首启还没建库的正常情况：目录里只剩 `diagnostics/` 之类，照原样拷（没有活的库，
        也就没有撕裂可言）。 */
        return super::transfer::copy_tree(source, dest);
    }
    vacuum_into(&from_db, &dest.join(DB_FILE)).await?;
    let mut bytes = fs::metadata(dest.join(DB_FILE)).map_or(0, |meta| meta.len());
    let items =
        fs::read_dir(source).map_err(|err| format!("读不了 {}：{err}", source.display()))?;
    for item in items.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        if name == DB_FILE || SIDECARS.contains(&name.as_str()) {
            continue;
        }
        let path = item.path();
        let to = dest.join(&name);
        bytes += if path.is_dir() {
            super::transfer::copy_tree(&path, &to)?
        } else {
            fs::copy(&path, &to).map_err(|err| format!("{}：{err}", path.display()))?
        };
    }
    Ok(bytes)
}

/// `VACUUM INTO` 到 `dest`。目标文件必须**不存在**（SQLite 对已存在的输出文件直接报错）。
async fn vacuum_into(source: &Path, dest: &Path) -> Result<(), String> {
    /* 重试幂等：上一次（可能是被 kill 的那次）在 `dest` 留下的半成品直接覆盖。`copy_all`
    的其余五项本来就是覆盖写，这里跟它们对齐，不为一个残片让用户永远切不过去。 */
    if dest.exists() {
        fs::remove_file(dest)
            .map_err(|err| format!("清不掉上一次的半成品 {}：{err}", dest.display()))?;
    }
    let options = SqliteConnectOptions::new()
        .filename(source)
        /* sqlx 0.8 默认就是 `false`，显式写出来是防「TOCTOU 窗口里源文件消失 → sqlx 建
        一个空库 → `VACUUM INTO` 成功搬走空库 → `quick_check` 报 ok」这一串零报错失效。 */
        .create_if_missing(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|err| format!("打开活动库 {} 失败：{err}", source.display()))?;
    let target = dest.to_string_lossy().into_owned();
    let outcome = sqlx::query("VACUUM INTO ?1")
        .bind(target)
        .execute(&pool)
        .await
        .map(|_| ())
        .map_err(|err| format!("生成活动库副本失败：{err}"));
    pool.close().await;
    outcome?;
    if !dest.is_file() {
        return Err(format!("生成活动库副本失败：{} 没有出现", dest.display()));
    }
    Ok(())
}

/// 核对活动库副本：只查**副本自身**（`PRAGMA quick_check`），不与源库比行数。
///
/// 为什么不比行数：源库此刻可能正在被用户记一条新的，比出不一致就是假报警；而
/// `quick_check` 让 SQLite 自己把副本的 B-tree 走一遍，看不见的结构性损坏当场现形。
pub(super) async fn verify_copy(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Ok(());
    }
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|err| format!("打开活动库副本失败：{err}"))?;
    let verdict: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(&pool)
        .await
        .map_err(|err| format!("核对活动库副本失败：{err}"))?;
    pool.close().await;
    if verdict != "ok" {
        return Err(format!("核对没通过：活动库副本 quick_check 报 {verdict}"));
    }
    Ok(())
}

/// 旧版（五项清单）搬迁用户的**孤儿活动库**：`current` 没有、`legacy` 有 → 补一份到 `dest`。
///
/// 为什么需要它：旧版清单里没有 `patina` 这一项，那批用户搬迁时 `patina/data` 留在了旧根；
/// 新版清单只在**当前根**里找它，于是报「缺失跳过」——数据还在、界面看着像丢了、日志干净。
/// 与本轮第 6 条是同一类失效：数据没丢，宿主看不见它。
///
/// 三条边界：
/// - **只补活动库**：其余五项当年已经搬过，再搬一遍会覆盖用户在新根里产生的新数据。
/// - `legacy` 不存在 / 不是目录 / 里面没有 `patina.db` → 静默跳过（不记 warn：绝大多数
///   用户根本没有这个目录，那不是异常）。
/// - 当前根已经有活动库 → 不插手（正常路径已经搬过）。
pub(super) async fn recover_legacy(current: &Path, legacy: Option<&Path>, dest: &Path) {
    let Some(legacy) = legacy else { return };
    let from_dir = Path::new(legacy).join(super::transfer::ACTIVITY_DIR);
    let already_there = current
        .join(super::transfer::ACTIVITY_DIR)
        .join(DB_FILE)
        .exists();
    if already_there || !from_dir.join(DB_FILE).is_file() {
        return;
    }
    let to = dest.join(super::transfer::ACTIVITY_DIR);
    match copy_activity_dir(&from_dir, &to).await {
        Ok(bytes) => crate::log_info!(
            "data root: 旧根 {} 的活动库补到 {}（{bytes} 字节）",
            from_dir.display(),
            to.display()
        ),
        /* 补不上不阻断这次切换：目标根能正常起来，只是活动历史还空着——比整次搬运失败好
        （用户此刻已经在新位置上等着用）。日志里有原文，用户报问题时能查到。 */
        Err(err) => crate::log_error!(
            "data root: 旧根 {} 的活动库没补上：{err}",
            from_dir.display()
        ),
    }
}
