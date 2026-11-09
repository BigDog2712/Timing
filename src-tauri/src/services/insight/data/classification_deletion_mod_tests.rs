//! `classification_deletion.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use sqlx::Executor;

async fn database() -> SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::services::insight::data::sqlite_pool::prepare_pool_schema(&pool, std::path::Path::new(":memory:"))
        .await
        .unwrap();
    pool
}

#[tokio::test]
async fn selected_application_only_and_recheck_before_erasing() {
    let pool = database().await;
    pool.execute("INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES ('Editor','root.exe',0,10,10),('Editor','child.exe',10,20,10);
        INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES ('ROOT.EXE','i',1),('child.exe','i',1);
        INSERT INTO settings(key,value) VALUES ('__app_link::child.exe','root.exe'),('__app_override::root.exe','{}'),('__app_override::child.exe','{}');
        INSERT INTO tool_activity_reminder_rules(target_kind,app_name,exe_name,label_snapshot,limit_ms,message,created_at,updated_at)
            VALUES ('app','Editor','root.exe','Dedicated',60000,'',1,1),('app','Editor',NULL,'Shared',60000,'',1,1)").await.unwrap();
    let target = Target::App("root.exe".into());
    let stale = run(&pool, &target, None).await.unwrap();
    assert_eq!(stale.links.len(), 1);
    assert!(stale
        .reminders
        .iter()
        .any(|r| r.shared && r.label == "Shared"));
    pool.execute(
        "INSERT INTO settings(key,value) VALUES ('__app_link::second.exe','root.exe')",
    )
    .await
    .unwrap();
    assert!(run(&pool, &target, Some(stale)).await.is_err());
    let plan = run(&pool, &target, None).await.unwrap();
    pool.execute("CREATE TRIGGER refuse_icon BEFORE DELETE ON icon_cache BEGIN SELECT RAISE(ABORT,'fixture'); END").await.unwrap();
    assert!(run(&pool, &target, Some(plan.clone())).await.is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
    pool.execute("DROP TRIGGER refuse_icon").await.unwrap();
    run(&pool, &target, Some(plan)).await.unwrap();
    for (query,expected) in [("SELECT count(*) FROM sessions WHERE exe_name='child.exe'",1),("SELECT count(*) FROM sessions WHERE exe_name='root.exe'",0),("SELECT count(*) FROM icon_cache",1),("SELECT count(*) FROM settings WHERE key GLOB '__app_link::*'",0),("SELECT count(*) FROM settings WHERE key='__app_override::root.exe'",0),("SELECT count(*) FROM tool_activity_reminder_rules WHERE label_snapshot='Shared'",1),("SELECT count(*) FROM tool_activity_reminder_rules WHERE label_snapshot='Dedicated'",0)]{
        assert_eq!(sqlx::query_scalar::<_,i64>(query).fetch_one(&pool).await.unwrap(),expected);
    }
}

#[tokio::test]
async fn group_deletion_erases_members_and_keeps_independent_sites() {
    let pool = database().await;
    pool.execute("INSERT INTO settings(key,value) VALUES ('__web_site::example.com','{\"version\":2,\"category\":\"office\",\"exceptions\":[\"example.com\"]}'),
        ('__web_domain_override::example.com','{}'),('__web_domain_override::docs.example.com','{}');
        INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES ('example.com','i',1),('docs.example.com','i',1),('cache.example.com','i',1);
        INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at)
        VALUES ('one','chrome','chrome.exe','example.com','example.com',0,10,10,1,1),('one','chrome','chrome.exe','docs.example.com','docs.example.com',10,20,10,1,1);
        INSERT INTO tool_activity_reminder_rules(target_kind,normalized_domain,label_snapshot,limit_ms,message,created_at,updated_at)
        VALUES ('web','docs.example.com','Docs',60000,'',1,1),('web','example.com','Independent',60000,'',1,1)").await.unwrap();
    let group = Target::Group("example.com".into());
    let plan = run(&pool, &group, None).await.unwrap();
    assert_eq!(
        plan.members.into_iter().collect::<Vec<_>>(),
        ["cache.example.com", "docs.example.com"]
    );
    let plan = run(&pool, &group, None).await.unwrap();
    assert_eq!(plan.reminders.len(), 1);
    run(&pool, &group, Some(plan)).await.unwrap();
    let independent = Target::Web("example.com".into());
    let plan = run(&pool, &independent, None).await.unwrap();
    assert_eq!((plan.links.len(), plan.reminders.len()), (1, 1));
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT normalized_domain FROM web_activity_segments")
            .fetch_one(&pool)
            .await
            .unwrap(),
        "example.com"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM web_favicon_cache")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    run(&pool, &independent, Some(plan)).await.unwrap();
    for table in [
        "web_activity_segments",
        "web_favicon_cache",
        "tool_activity_reminder_rules",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
    }
}
