//! 升级路径：插件后来新增了第三种落点，**已有用户**能不能拿到它。
//!
//! 这是本轮唯一一个会让功能「只对新装用户可用」的坑。`config::load` 原本是
//! `saved.or(defaults)`（保存值整体优先），而 v0.4.0 的用户保存过的配置里只有
//! timers + notes 两条。设置页只渲染 `config.bindings`、没有「添加落点」入口，
//! 所以 saved 一旦存在，`todos` 就永远进不了生效配置——待办区块一次也不会被写出来。
//!
//! 修法见 `config::merge_bindings`：saved 的总开关、顺序与内容原样保留，插件默认值里
//! **saved 完全没有的 kind** 追加到末尾。用户主动禁用（`enabled: false`）的落点仍在
//! saved 里，因此不会被默认值重新打开。
//!
//! 这里的「插件默认值」就是仓库里真实的 `plugins/md-sync`：扫描的 dev 源优先于
//! `app_data` 下的测试插件，所以 `config::load` 拿到的是它声明的那三条落点。

use crate::infra::md_file;
use crate::models::md_sync::{MdSyncBinding, MdSyncConfig, MdSyncKind};
use crate::repositories::todo as todo_repo;
use crate::services;
use crate::services::md_sync::config;

use super::md_sync::{at, binding, env, file_for, Env, NOTES_HEADING, TIMERS_HEADING};

const TODOS_HEADING: &str = "#### 待办事项";

/// 模拟 v0.4.0 用户：保存过只有两种落点的配置。
async fn save_old_config(env: &Env) {
    let old = MdSyncConfig {
        poll_secs: 900,
        enabled: true,
        bindings: vec![
            binding(MdSyncKind::Timers, &env.vault, "{date}.md", TIMERS_HEADING),
            binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
        ],
    };
    config::save(&env.pool, &old).await.unwrap();
}

#[tokio::test]
async fn a_saved_config_gets_the_new_kind_from_the_plugin() {
    let env = env("md-upgrade").await;
    save_old_config(&env).await;

    let view = services::md_sync::get_view(&env.pool, &env.app_data)
        .await
        .unwrap();

    assert_eq!(view.config.bindings.len(), 3, "新 kind 应被补齐");
    assert_eq!(
        view.config.bindings[2].kind,
        MdSyncKind::Todos,
        "保存值在前，补进来的落点追加在后面"
    );
    /* 用户已有的落点原样保留，不被插件默认值覆盖。 */
    assert_eq!(view.config.bindings[0].heading, TIMERS_HEADING);
    assert_eq!(
        view.config.bindings[0].root,
        env.vault.display().to_string()
    );
}

#[tokio::test]
async fn a_disabled_saved_binding_stays_disabled() {
    let env = env("md-upgrade-off").await;
    let mut notes = binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING);
    notes.enabled = false;
    let old = MdSyncConfig {
        poll_secs: 900,
        enabled: true,
        bindings: vec![
            binding(MdSyncKind::Timers, &env.vault, "{date}.md", TIMERS_HEADING),
            notes,
        ],
    };
    config::save(&env.pool, &old).await.unwrap();

    let view = services::md_sync::get_view(&env.pool, &env.app_data)
        .await
        .unwrap();
    let saved = view
        .config
        .bindings
        .iter()
        .find(|item| item.kind == MdSyncKind::Notes)
        .expect("保存过的便利贴落点应在");
    assert!(!saved.enabled, "用户关掉的落点不能被默认值重新打开");
    assert!(view
        .config
        .bindings
        .iter()
        .any(|item| item.kind == MdSyncKind::Todos));
}

#[tokio::test]
async fn the_merged_binding_can_actually_write_the_block() {
    let env = env("md-upgrade-write").await;
    save_old_config(&env).await;

    let view = services::md_sync::get_view(&env.pool, &env.app_data)
        .await
        .unwrap();
    let merged = view.config.bindings.clone();
    let todos = merged
        .iter()
        .find(|item| item.kind == MdSyncKind::Todos)
        .expect("升级后应能拿到 todos 落点");
    /* 补齐的是完整落点，不是只有 kind 的空壳。 */
    assert_eq!(todos.heading, TODOS_HEADING);
    assert!(!todos.file.trim().is_empty());

    /* 把落点全部指向临时目录再跑：目的是不碰插件里声明的真实路径（作者本机日记）。 */
    let redirected: Vec<MdSyncBinding> = merged
        .into_iter()
        .map(|mut item| {
            item.root = env.vault.display().to_string();
            item
        })
        .collect();
    config::save(
        &env.pool,
        &MdSyncConfig {
            poll_secs: 900,
            enabled: true,
            bindings: redirected,
        },
    )
    .await
    .unwrap();

    todo_repo::insert(
        &env.pool,
        "升级后该出现的待办",
        None,
        Some(at(env.date.succ_opt().unwrap(), 9, 0)),
        None,
        0,
        at(env.date, 8, 0),
    )
    .await
    .unwrap();

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    let text = std::fs::read_to_string(file_for(&env)).unwrap();
    assert!(text.contains(TODOS_HEADING), "{text}");
    let body = md_file::body_in_text(&text, TODOS_HEADING).unwrap();
    assert!(body.contains("升级后该出现的待办"), "{body}");
}
