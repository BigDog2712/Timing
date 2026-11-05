//! Markdown 双向同步（V0.4.0 / 插件 API v2）。
//!
//! 覆盖：SQL → MD 的 Planner 格式、MD 改时间回写 SQL、MD 删组软删、
//! 便利贴表格往返、配置校验错误码。

use std::path::{Path, PathBuf};

use chrono::{Local, NaiveDate, TimeZone};
use sqlx::SqlitePool;

use crate::error::ErrorCode;
use crate::infra::md_file;
use crate::models::md_sync::{MdSyncBinding, MdSyncConfig, MdSyncKind};
use crate::repositories::settings;
use crate::tests::support::{
    expect_err, fresh_pool, insert_saved, new_item, scalar_i64, unique_dir,
};
use crate::{services, services::md_sync::config};

pub(super) const TIMERS_HEADING: &str = "#### 事项计时";
pub(super) const NOTES_HEADING: &str = "#### 便利贴";
pub(super) const TODOS_HEADING: &str = "#### 待办事项";

/* 夹具对本目录的其他用例模块可见：`md_sync_live` 复用同一套临时库 + 落点配置。 */
pub(super) struct Env {
    pub(super) pool: SqlitePool,
    pub(super) app_data: PathBuf,
    pub(super) vault: PathBuf,
    pub(super) date: NaiveDate,
}

pub(super) async fn env(tag: &str) -> Env {
    let app_data = unique_dir(tag);
    std::fs::create_dir_all(&app_data).unwrap();
    write_test_plugin(&app_data);

    let vault = unique_dir(&format!("{tag}-vault"));
    std::fs::create_dir_all(&vault).unwrap();
    let env = Env {
        pool: fresh_pool(tag).await,
        app_data,
        vault,
        date: Local::now().date_naive(),
    };
    /* **安全底线，不要删**：插件扫描的 dev 源（仓库 `plugins/`）优先级高于本目录里
    写的测试插件，所以「还没保存配置 / 只保存了部分落点」的用例会拿到仓库 `md-sync`
    声明的真实落点——仓库 `plugin.json` 里的占位目录 `%USERPROFILE%\Documents\Timing`
    （0.5.0 前是作者本机的云同步日记目录）。那样一次 `md_sync::run` 就会把空库内容
    写进用户的真实日记（本轮真出过这个事故）。这里先把**三种 kind** 都锁到临时目录，
    配合 `save_binding` 的「按 kind 就地替换」，任何用例都不可能写到仓库之外去。 */
    for (kind, heading) in [
        (MdSyncKind::Timers, TIMERS_HEADING),
        (MdSyncKind::Notes, NOTES_HEADING),
        (MdSyncKind::Todos, TODOS_HEADING),
    ] {
        save_binding(&env.pool, binding(kind, &env.vault, "{date}.md", heading)).await;
    }
    env
}

/// 测试用插件：只声明 mdSync，落点由用例保存的配置覆盖。
fn write_test_plugin(app_data: &Path) {
    let dir = app_data.join("plugins").join("md-sync");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("plugin.json"),
        r#"{"id":"md-sync","name":"测试同步","version":"1.0.0","apiVersion":2,
            "contributes":{"mdSync":{"bindings":[]}}}"#,
    )
    .unwrap();
}

pub(super) fn binding(kind: MdSyncKind, root: &Path, file: &str, heading: &str) -> MdSyncBinding {
    MdSyncBinding {
        kind,
        enabled: true,
        root: root.display().to_string(),
        file: file.into(),
        heading: heading.into(),
    }
}

pub(super) async fn save_binding(pool: &SqlitePool, binding: MdSyncBinding) {
    /* **不能整体替换**：`config::load` 现在会把「保存值里没有的 kind」用插件默认值补齐，
    而测试环境的默认值来自仓库 `plugins/md-sync`（`%USERPROFILE%\Documents\Timing` 占位目录）。
    整体替换只留一个 kind 时，另外两个 kind 会被补齐成真实路径，一次 run 就写到仓库
    外面去。所以这里改成「按 kind 就地替换」，其余落点保持 `env()` 预置的临时目录版本。 */
    let mut current = match settings::get_value(pool, config::CONFIG_KEY).await {
        Ok(Some(raw)) => serde_json::from_str::<MdSyncConfig>(&raw).unwrap_or_default(),
        _ => MdSyncConfig::default(),
    };
    match current
        .bindings
        .iter_mut()
        .find(|item| item.kind == binding.kind)
    {
        Some(slot) => *slot = binding,
        None => current.bindings.push(binding),
    }
    current.enabled = true;
    config::save(pool, &current).await.unwrap();
}

pub(super) fn at(date: NaiveDate, hour: u32, minute: u32) -> i64 {
    Local
        .from_local_datetime(&date.and_hms_opt(hour, minute, 0).unwrap())
        .earliest()
        .unwrap()
        .timestamp_millis()
}

pub(super) fn file_for(env: &Env) -> PathBuf {
    env.vault
        .join(format!("{}.md", env.date.format("%Y-%m-%d")))
}

#[tokio::test]
async fn exports_planner_format_and_imports_edited_time() {
    let env = env("md-timers").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1800,
    )
    .await;
    save_binding(
        &env.pool,
        binding(MdSyncKind::Timers, &env.vault, "{date}.md", TIMERS_HEADING),
    )
    .await;

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert!(report.exported >= 1);

    let file = file_for(&env);
    let text = std::fs::read_to_string(&file).unwrap();
    let day = env.date.format("%Y-%m-%d");
    assert!(text.contains("#### 事项计时"));
    assert!(text.contains("- [ ] 写代码"));
    assert!(text.contains(&format!("      - start: {day} 09:00:00")));
    assert!(text.contains(&format!("        end: {day} 09:30:00")));

    /* 用户把结束时间从 09:30 改成 09:45。 */
    let body = md_file::body_in_text(&text, TIMERS_HEADING).unwrap();
    let body = body
        .replace("09:00:00", "09:05:00")
        .replace("09:30:00", "09:45:00");
    let edited = md_file::replace_in_text(&text, TIMERS_HEADING, &body);
    std::fs::write(&file, edited).unwrap();

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert!(report.kinds.contains(&MdSyncKind::Timers));

    let (start, end) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT started_at, ended_at FROM time_records \
         WHERE status = 'saved' AND deleted_at IS NULL",
    )
    .fetch_one(&env.pool)
    .await
    .unwrap();
    assert_eq!(start, at(env.date, 9, 5));
    assert_eq!(end, at(env.date, 9, 45));
}

#[tokio::test]
async fn deleting_a_group_soft_deletes_its_records() {
    let env = env("md-delete").await;
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1800,
    )
    .await;
    save_binding(
        &env.pool,
        binding(MdSyncKind::Timers, &env.vault, "{date}.md", TIMERS_HEADING),
    )
    .await;
    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();

    let file = file_for(&env);
    let text = std::fs::read_to_string(&file).unwrap();
    let edited = md_file::replace_in_text(&text, TIMERS_HEADING, "");
    std::fs::write(&file, edited).unwrap();

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    let alive = scalar_i64(
        &env.pool,
        "SELECT COUNT(*) FROM time_records WHERE status = 'saved' AND deleted_at IS NULL",
    )
    .await;
    assert_eq!(alive, 0);
}

#[tokio::test]
async fn invalid_config_uses_dedicated_error_code() {
    let env = env("md-invalid").await;
    let config = MdSyncConfig {
        enabled: true,
        bindings: vec![binding(
            MdSyncKind::Timers,
            &env.vault,
            "{date}.md",
            "事项计时",
        )],
    };
    let code = expect_err(config::save(&env.pool, &config).await);
    assert_eq!(code, ErrorCode::MdSyncConfigInvalid);
}

#[tokio::test]
async fn view_reports_installed_plugin_and_today() {
    let env = env("md-view").await;
    let view = services::md_sync::get_view(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(view.installed);
    assert_eq!(view.plugin_id.as_deref(), Some("md-sync"));
    assert!(view.plugin_name.is_some());
    assert_eq!(view.today, env.date.format("%Y-%m-%d").to_string());
}

#[tokio::test]
async fn missing_file_is_created_with_heading_only_when_there_is_data() {
    let env = env("md-empty").await;
    save_binding(
        &env.pool,
        binding(MdSyncKind::Timers, &env.vault, "{date}.md", TIMERS_HEADING),
    )
    .await;
    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(!file_for(&env).exists(), "没有数据时不应创建空日记");

    let item = new_item(&env.pool, "喝水").await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 10, 0),
        at(env.date, 10, 5),
        300,
    )
    .await;
    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    let text = std::fs::read_to_string(file_for(&env)).unwrap();
    assert!(text.starts_with("#### 事项计时\n- [ ] 喝水"));
}
