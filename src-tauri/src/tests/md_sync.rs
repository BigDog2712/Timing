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
    pub(super) vault: PathBuf,
    pub(super) date: NaiveDate,
}

pub(super) async fn env(tag: &str) -> Env {
    let vault = unique_dir(&format!("{tag}-vault"));
    std::fs::create_dir_all(&vault).unwrap();
    let env = Env {
        pool: fresh_pool(tag).await,
        vault,
        date: Local::now().date_naive(),
    };
    /* **安全底线，不要删**：内核默认落点指向 `%USERPROFILE%\Documents\Timing`
    （用户的真实文档目录），而 `config::load` 会把「保存值里没有的 kind」用默认值补齐。
    所以每个用例开跑前先把**三种 kind** 一次锁到临时目录——任何用例都不可能写到
    仓库或用户目录之外去（V0.4.0 出过一次「一次 run 写进作者本机日记」的事故）。 */
    let seeded = MdSyncConfig {
        cloud: None,
        enabled: true,
        poll_secs: 900,
        bindings: vec![
            binding(MdSyncKind::Timers, &env.vault, "{date}.md", TIMERS_HEADING),
            binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
            binding(MdSyncKind::Todos, &env.vault, "{date}.md", TODOS_HEADING),
        ],
    };
    config::save(&env.pool, &seeded).await.unwrap();
    env
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
    /* **不能整体替换**：`config::load` 会把「保存值里没有的 kind」用**内核默认值**补齐，
    而默认落点指向用户的真实文档目录。整体替换只留一个 kind 时，另外两个 kind 会被
    补齐成真实路径，一次 run 就写到仓库外面去。所以这里改成「按 kind 就地替换」，
    其余落点保持 `env()` 预置的临时目录版本。 */
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

    let report = services::md_sync::run(&env.pool).await.unwrap();
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

    let report = services::md_sync::run(&env.pool).await.unwrap();
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
    services::md_sync::run(&env.pool).await.unwrap();

    let file = file_for(&env);
    let text = std::fs::read_to_string(&file).unwrap();
    let edited = md_file::replace_in_text(&text, TIMERS_HEADING, "");
    std::fs::write(&file, edited).unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
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
        cloud: None,
        poll_secs: 900,
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
async fn view_reports_kernel_default_bindings_and_today() {
    let env = env("md-view").await;
    let view = services::md_sync::get_view(&env.pool).await.unwrap();

    /* [V0.11.5] 同步是内核功能：视图不再有「插件装没装」，而是直接给出三档落点。 */
    let kinds: Vec<MdSyncKind> = view.config.bindings.iter().map(|item| item.kind).collect();
    assert_eq!(
        kinds,
        vec![MdSyncKind::Timers, MdSyncKind::Notes, MdSyncKind::Todos],
        "三档顺序固定为 timers → notes → todos"
    );
    assert_eq!(view.config.bindings[0].heading, TIMERS_HEADING);
    assert_eq!(view.config.bindings[1].heading, NOTES_HEADING);
    assert_eq!(view.config.bindings[2].heading, TODOS_HEADING);
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
    services::md_sync::run(&env.pool).await.unwrap();
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
    services::md_sync::run(&env.pool).await.unwrap();
    let text = std::fs::read_to_string(file_for(&env)).unwrap();
    assert!(text.starts_with("#### 事项计时\n- [ ] 喝水"));
}
