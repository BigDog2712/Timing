//! 存量备份的**格式兼容**护栏。
//!
//! ## 这个文件为什么必须存在
//!
//! 备份 zip 里的 `manifest.json` 是**已经写到用户磁盘和 WebDAV 上**的契约。改名/换格式
//! 时最坏的一档不是报错，而是**静默失踪**：
//!
//! · `is_snapshot_archive()` 只做 `format == SNAPSHOT_FORMAT`，不符就返回 `Ok(false)`；
//! · 调用方 `prepared_source` 把它当成「这不是快照」直接跳过。
//!
//! 于是备份列表里那批文件凭空消失，零报错、零日志，用户只能靠「数量对不上」发现。
//! 而代码可以回滚，已经同步到远端的那批备份不会自己回来 —— 这是整个改造里唯一
//! 「上线后无法热修复」的一类损失。
//!
//! ## 两条测试，方向相反，缺一不可
//!
//! | 测试 | 构造/断言用什么 | 守的是什么 |
//! |---|---|---|
//! | `legacy_snapshot_archive_stays_recognised_and_restorable` | **手写字面量** | 已发出去的格式还能打开 |
//! | `manifest_format_constants_are_frozen` | **引用常量** | 写入侧常量不许动 |
//!
//! ## 为什么行为测试的值是**手写字面量**而不是引用常量
//!
//! 引用 `SNAPSHOT_FORMAT` / `SNAPSHOT_PRODUCT` / `DATABASE_ENTRY` 的话，这个测试会跟着
//! 常量一起变：常量改了、测试照样绿，而老备份照样打不开。只有把「已发出去的线上格式」
//! 逐字写死在这里，它才真正守得住兼容。**改这个文件里的字面量 = 主动放弃老用户的备份**
//! —— 若要引入新格式，正确做法是让读取侧接受新旧两版（见 `manifest_contract` 文件头），
//! 而不是来改这里。

/* `super::*` 已经把 `snapshot` 的私有项（manifest 结构、各 helper、`fs` / `File` /
   `BTreeMap` / zip 类型）一并带进来 —— 子模块可见父模块私有项。 */
use super::*;

/// 独占的临时目录（`ExtractedSnapshot` 自己有 Drop，这里只兜住本文件的中间产物）。
struct LegacyTestDir(PathBuf);

impl LegacyTestDir {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("{tag}-{}", unique_suffix()));
        fs::create_dir_all(&dir).expect("create legacy snapshot test dir");
        Self(dir)
    }
}

impl Drop for LegacyTestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// 按**线上存量存档的形状**手搓一份备份，然后走两条真实入口：
/// ① `is_snapshot_archive`（备份列表的嗅探）；② `extract_snapshot_archive`（恢复）。
#[tokio::test]
async fn legacy_snapshot_archive_stays_recognised_and_restorable() {
    use crate::services::activity::data::sqlite_pool::{
        open_single_connection_sqlite_pool, prepare_pool_schema,
    };

    let work = LegacyTestDir::new("timing-legacy-snapshot");
    let db_path = work.0.join("source.db");
    let archive_path = work.0.join("legacy-backup.zip");

    let pool = open_single_connection_sqlite_pool(&db_path, true)
        .await
        .expect("open source database");
    prepare_pool_schema(&pool, &db_path)
        .await
        .expect("prepare source schema");
    sqlx::query("INSERT INTO settings (key, value) VALUES ('legacy-format-test', 'kept')")
        .execute(&pool)
        .await
        .expect("insert marker row");
    let counts = read_counts(&pool).await.expect("read source counts");
    pool.close().await;

    let (migration_head, migration_fingerprint) = inspect_database_identity(&db_path, true)
        .await
        .expect("inspect source identity");
    let database_sha256 = sha256_file(&db_path).expect("hash source database");
    let size_bytes = fs::metadata(&db_path)
        .expect("read source metadata")
        .len();

    /* ★ 以下四个字符串是**已发出去的线上格式**，故意逐字写死、不引用任何生产常量。 */
    let manifest = SnapshotManifest {
        format: "PatinaSQLiteSnapshot-1".to_string(),
        product: "Patina".to_string(),
        created_at_ms: 1_700_000_000_000,
        app_version: "0.12.0".to_string(),
        database: SnapshotDatabaseManifest {
            path: "database/patina.db".to_string(),
            size_bytes,
            sha256: database_sha256.clone(),
            migration_head,
            migration_fingerprint,
        },
        restore: SnapshotRestoreManifest {
            strategies: vec!["replace".to_string(), "merge".to_string()],
        },
        counts,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).expect("serialize manifest");

    let mut checksum_files = BTreeMap::new();
    checksum_files.insert("manifest.json".to_string(), sha256_bytes(&manifest_bytes));
    checksum_files.insert("database/patina.db".to_string(), database_sha256);
    let checksum_bytes = serde_json::to_vec_pretty(&SnapshotChecksums {
        algorithm: "sha256".to_string(),
        files: checksum_files,
    })
    .expect("serialize checksums");

    let mut zip = ZipWriter::new(File::create(&archive_path).expect("create archive"));
    write_zip_entry(&mut zip, "manifest.json", &manifest_bytes).expect("write manifest entry");
    zip.start_file(
        "database/patina.db",
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
    )
    .expect("start database entry");
    let mut source = File::open(&db_path).expect("open source database for archiving");
    std::io::copy(&mut source, &mut zip).expect("copy database into archive");
    drop(source);
    write_zip_entry(&mut zip, "checksums.json", &checksum_bytes).expect("write checksums entry");
    zip.finish().expect("finish archive");

    /* ① 备份列表的嗅探：老格式必须仍被认成「本应用的快照」。
       这里一旦变成 false，那批备份就从列表里静默消失。 */
    assert!(
        is_snapshot_archive(&archive_path).expect("sniff legacy archive"),
        "老格式备份必须仍被 is_snapshot_archive 认出"
    );

    /* ② 恢复入口：不仅认得，还得真的能打开并读回数据。 */
    let extracted = extract_snapshot_archive(&archive_path, false)
        .await
        .expect("老格式备份必须仍可恢复");
    let restored = open_single_connection_sqlite_pool(&extracted.db_path, false)
        .await
        .expect("open extracted database");
    let value: String =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'legacy-format-test'")
            .fetch_one(&restored)
            .await
            .expect("read marker row from restored database");
    restored.close().await;
    assert_eq!(value, "kept", "恢复出来的库必须是原来那份数据");
}

/* ── 值锁：常量 → 字面量 ────────────────────────────────────────────────────────
   方向与上面那条**相反**：这里必须引用常量，锁的正是「常量本身不许动」。
   `assert_eq!(SNAPSHOT_FORMAT, "…")` 不是恒真——常量一改它就红。

   为什么值锁和行为锁都要（只做一半都会漏）：
   · 只有行为测试：写入侧悄悄漂到新格式没人发现——读取侧新旧都收，测试照样绿，
     而新写出去的备份只有新版本能打开。
   · 只有值锁：读取侧的兼容集合被误删（比如把 `supported_database_entries()` 改窄）
     也照样绿，因为值锁只看常量值。 */
#[test]
fn manifest_format_constants_are_frozen() {
    assert_eq!(SNAPSHOT_FORMAT, "PatinaSQLiteSnapshot-1");
    assert_eq!(DATABASE_ENTRY, "database/patina.db");
    assert_eq!(SNAPSHOT_PRODUCT, "Patina");
    assert_eq!(CHECKSUM_ALGORITHM, "sha256");
    /* 有序：manifest 里写的顺序也算契约的一部分，所以比数组而不是比集合。 */
    assert_eq!(SUPPORTED_RESTORE_STRATEGIES, ["replace", "merge"]);

    /* 写入侧的条目名必须落在读取侧的允许集合里。这条把「写一个、收另一个」这个
       只在 T05 才会暴露的形状提前钉死在这里。 */
    assert!(
        supported_database_entries().contains(DATABASE_ENTRY),
        "写入侧条目名 {DATABASE_ENTRY} 不在读取侧允许集合里 —— 新备份写出去就没人读得回"
    );
    assert_eq!(supported_database_entries().len(), 1, "今天的允许集合只该有当前条目");
}
