//! [V0.11.16] B4 的**持久化层**证据：老用户三档 `file` / `root` 各不相同时，一次
//! 「什么都没改的保存」不许把三档统一掉（PRD B4 / N2 / 设计 R-3）。
//!
//! ## 为什么不只在前端断言
//!
//! 前端测试里 `mdSyncApi.save` 是 mock，最多证明「传给后端的数组没被统一」。真正会让
//! 用户文件找不到的是 `settings` 表里那份 JSON 被改写——那是不可逆的。所以本用例走
//! 真实的读写链路：
//!
//! ```text
//! 种子写原始 JSON（模拟 v0.11.15 老用户的三档）
//!   → config::load（= 打开设置页拿到的 config）
//!   → config::save（= 用户什么都不改直接点「保存并同步」时回传的那一份）
//!   → 再读 settings 原始 JSON，逐字段比
//! ```
//!
//! 中间那一跳 `load → save`（前端原样回显）正是本轮「单框写三档」最容易被写成 bug 的
//! 地方：只要 `applyShared` 在没有用户意图时也扇出，或者后端在 `save` 里「顺手统一」，
//! 这份 JSON 就会从三档变一档。断言逐字段而不是整体字符串：字段顺序与空格不该成为
//! 判据，值才是。
//!
//! 三档 `file` **全不相同**（`{date}.md` / `{date}-notes.md` / `{date}-todos.md`）：
//! PRD B4 的例子是两档，但如果只是「两档不同」，统一到显示值只毁掉一档；三档全不同时
//! 任何一次误扇出都会同时改掉两档，判据更灵敏。

use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::models::md_sync_config::MdSyncConfig;
use crate::repositories::settings;
use crate::services::md_sync::config;
use crate::tests::support::fresh_pool;

/// 三档 `root` 全不同：老用户从 v0.10 升级时最常见的形状（前两档是 Obsidian 目录，
/// merge 补进来的 `todos` 用 `%APP_DIR%\md`）。
const TIMERS_ROOT: &str = r"C:\Vault";
const NOTES_ROOT: &str = r"C:\Vault2";
const TODOS_ROOT: &str = r"%APP_DIR%\md";

/// 三档 `file` 全不同（PRD B4 的核心：界面只显示一档，另外两档不许被悄悄改掉）。
const TIMERS_FILE: &str = "{date}.md";
const NOTES_FILE: &str = "{date}-notes.md";
const TODOS_FILE: &str = "{date}-todos.md";

fn binding_json(kind: &str, root: &str, file: &str, heading: &str) -> Value {
    json!({
        "kind": kind,
        "enabled": true,
        "root": root,
        "file": file,
        "heading": heading,
    })
}

/// 老用户的保存值（独立 JSON 文档，不是「我们自己写出去的结构」——后者会绕一圈验自己）。
fn legacy_config_json() -> String {
    json!({
        "enabled": true,
        "pollSecs": 900,
        "bindings": [
            binding_json("timers", TIMERS_ROOT, TIMERS_FILE, "#### 事项计时"),
            binding_json("notes", NOTES_ROOT, NOTES_FILE, "#### 便利贴"),
            binding_json("todos", TODOS_ROOT, TODOS_FILE, "#### 待办事项"),
        ],
    })
    .to_string()
}

async fn seed(pool: &SqlitePool, raw: &str) {
    settings::set_value(pool, config::CONFIG_KEY, raw, crate::platform::clock::now_ms())
        .await
        .expect("写入老配置应成功");
}

/// 读 `settings` 表里那段 JSON 的 `bindings[i][field]`（逐字段比，不整串比）。
async fn persisted(pool: &SqlitePool) -> Value {
    let raw = settings::get_value(pool, config::CONFIG_KEY)
        .await
        .expect("读取配置应成功")
        .expect("保存之后配置键必须存在");
    serde_json::from_str(&raw).expect("保存出去的必须仍是合法 JSON")
}

#[track_caller]
fn field_of(saved: &Value, index: usize, field: &str) -> String {
    saved["bindings"][index][field]
        .as_str()
        .unwrap_or_else(|| panic!("bindings[{index}].{field} 必须是字符串：{saved}"))
        .to_string()
}

/// **B4 的主判据**：打开设置 → 什么都不改 → 保存 → `settings` 表里三档原值一个不动。
///
/// 只要 `applyShared` 在没有用户意图时扇出（例如把 `shared.file` 恒当非空），或者
/// `config::save` 里「顺手统一一下」，这条立刻红。
#[tokio::test]
async fn a_no_touch_save_keeps_every_binding_file_and_root() {
    let pool = fresh_pool("md-no-touch").await;
    seed(&pool, &legacy_config_json()).await;

    /* 用户什么都没改：前端把 `load` 回来的 config 原样回传（`resolvedBindings` 恒等） */
    let loaded: MdSyncConfig = config::load(&pool).await.expect("读取配置应成功");
    config::save(&pool, &loaded).await.expect("保存应成功");

    let saved = persisted(&pool).await;
    assert_eq!(saved["bindings"].as_array().map(Vec::len), Some(3));

    assert_eq!(field_of(&saved, 0, "file"), TIMERS_FILE, "计时档的 file 被改了");
    assert_eq!(field_of(&saved, 1, "file"), NOTES_FILE, "便利贴档的 file 被统一掉了");
    assert_eq!(field_of(&saved, 2, "file"), TODOS_FILE, "待办档的 file 被统一掉了");

    assert_eq!(field_of(&saved, 0, "root"), TIMERS_ROOT);
    assert_eq!(field_of(&saved, 1, "root"), NOTES_ROOT, "便利贴档的 root 被统一掉了");
    assert_eq!(field_of(&saved, 2, "root"), TODOS_ROOT, "待办档的 root 被统一掉了");
}

/// 同一件事的**另一半**：`config::load` 不许在三档不全相同时替用户挑一个值。
///
/// 设置页的单框显示的是「计时那一档」（`mirrorOf`）；若 `load` 先把三档抹平，那条
/// 「三档落点不同：…」的提示与「逐个设置」出口就永远不会出现——用户既看不到差异，
/// 也没有改回来的路。
#[tokio::test]
async fn loading_a_mixed_config_does_not_flatten_it() {
    let pool = fresh_pool("md-no-flatten").await;
    seed(&pool, &legacy_config_json()).await;

    let loaded = config::load(&pool).await.expect("读取配置应成功");
    let files: Vec<&str> = loaded.bindings.iter().map(|item| item.file.as_str()).collect();
    let roots: Vec<&str> = loaded.bindings.iter().map(|item| item.root.as_str()).collect();

    assert_eq!(files, vec![TIMERS_FILE, NOTES_FILE, TODOS_FILE]);
    assert_eq!(roots, vec![TIMERS_ROOT, NOTES_ROOT, TODOS_ROOT]);
}

/// **T1 的另一半（后端侧）**：用户把单框改成 `{date}-asd.md` 保存后，三档确实统一成
/// 新值——「不扇出」不能退化成「永远不扇出」，否则 PRD R2 / B2 就不成立。
#[tokio::test]
async fn an_explicit_edit_is_persisted_verbatim() {
    let pool = fresh_pool("md-explicit-edit").await;
    seed(&pool, &legacy_config_json()).await;

    /* 模拟前端 `applyShared` 的结果：用户亲手改过 `file`，三档一起变成新值 */
    let mut edited = config::load(&pool).await.expect("读取配置应成功");
    for binding in &mut edited.bindings {
        binding.file = "{date}-asd.md".to_string();
    }
    config::save(&pool, &edited).await.expect("保存应成功");

    let saved = persisted(&pool).await;
    for index in 0..3 {
        assert_eq!(field_of(&saved, index, "file"), "{date}-asd.md");
    }
    /* 只改 `file`：`root` 三档仍是各自原值（字段之间不许串味） */
    assert_eq!(field_of(&saved, 1, "root"), NOTES_ROOT);
}
