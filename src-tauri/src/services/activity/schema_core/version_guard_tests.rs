//! 「老版本的 Timing 打开被升级过的库」必须报一句人话（裁决 2）。
//!
//! 场景是真实会发生的：用户装回旧版、或者两台机器同步了 `patina.db`。
//! 旧版的迁移表只到 27，而账本里有 28 → sqlx 抛
//! `migration 28 was previously applied but is missing in the resolved migrations`。
//! 这句话对用户等于「报错不可读」，所以这里既钉映射，也钉**真的会抛出那条错误**
//! （而不是只测字符串拼接：映射对了但错误类型变了，用户照样看不懂）。

use super::ensure::{describe_migration_failure, migrator_up_to};
use super::ensure_schema_at;
use std::path::Path;

/// 先建一个 head 28 的库（真实路径），再用只含 1–27 的 Migrator 去跑。
#[test]
fn opening_a_newer_database_with_an_older_build_explains_itself() {
    tauri::async_runtime::block_on(async {
        let dir = std::env::temp_dir().join(format!("timing-version-guard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("patina.db");
        let pool =
            crate::services::activity::data::sqlite_pool::open_single_connection_sqlite_pool(
                &db_path, true,
            )
            .await
            .unwrap();
        ensure_schema_at(&pool, &db_path).await.unwrap();

        let error = migrator_up_to(27)
            .await
            .unwrap()
            .run(&pool)
            .await
            .unwrap_err();
        let message = describe_migration_failure(&error, &db_path);
        println!("{message}");

        assert!(message.contains("更新版本的 Timing"), "{message}");
        assert!(
            message.contains(&db_path.display().to_string()),
            "报错必须写出真实数据目录：{message}"
        );
        assert!(message.contains("backups"), "{message}");
        assert!(
            !message.contains("previously applied"),
            "不许把 sqlx 的英文原话直接甩给用户：{message}"
        );
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    });
}

/// 校验和漂移（混装两个版本、或改过已发布迁移的正文）也要有可执行的出口。
#[test]
fn modified_migration_checksum_mentions_both_versions_and_backups() {
    let error = sqlx::migrate::MigrateError::VersionMismatch(28);
    let message = describe_migration_failure(&error, Path::new("D:/data/patina.db"));
    assert!(message.contains("校验和"), "{message}");
    assert!(message.contains("D:/data/patina.db"), "{message}");
    assert!(message.contains("backups"), "{message}");
}
