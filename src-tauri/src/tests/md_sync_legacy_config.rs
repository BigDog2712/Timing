//! 老库读取：md 同步内核化（V0.11.5）之后，V0.4.0 用户存下的那段 JSON 还能不能原样活着。
//!
//! 与 `md_sync_upgrade.rs` 的分工：那边走 `config::save` 写一份**结构化**配置，验
//! 「新 kind 补不补得进来」；这里构造**独立 JSON 文档**，验「用户自己的东西留不留得住」。
//! 为什么必须是独立 JSON 而不是 `MdSyncConfig { .. }` 再 `save`：`save` 会先
//! `validate()` 再序列化，等于让「我们自己写的结构」绕一圈回来验自己。老用户的库是
//! V0.4.0 的另一版代码写进去的，只有独立文档才代表那个真实形状。
//!
//! 构造用 `serde_json::json!` 而不是 `r#"…"#` 字面量：标题里的 `####` 会让 `r#"…"#`
//! 在 `"#` 处提前终止（`"####` 的前两个字符就是终止符），可读性会毁在转义上。
//!
//! **本文件不调用 `services::md_sync::run`**：`config::load` 会把保存值里没有的 kind
//! 补成内核默认值，而默认值指向 `%USERPROFILE%\Documents\Timing`——一次 run 就会写进
//! 作者本机文档目录。关闸那一侧的证据在 `md_sync_disabled_gate.rs`（那里全部重定向到临时目录）。

use serde_json::json;
use sqlx::SqlitePool;

use crate::models::md_sync::{MdSyncConfig, MdSyncKind};
use crate::models::md_sync_config::{MD_SYNC_DEFAULT_FILE, MD_SYNC_DEFAULT_ROOT};
use crate::repositories::settings;
use crate::services::md_sync::config;
use crate::tests::support::fresh_pool;

use super::md_sync::{NOTES_HEADING, TIMERS_HEADING, TODOS_HEADING};

/// 老用户自定义的落点根目录（与内核默认值差异明显，肉眼可辨）。
const USER_ROOT: &str = r"D:\MyVault";

/// 直接往 `settings` KV 写一段原始 JSON —— 模拟老版本应用留下的值。
async fn seed_raw(pool: &SqlitePool, raw: &str) {
    settings::set_value(
        pool,
        config::CONFIG_KEY,
        raw,
        crate::platform::clock::now_ms(),
    )
    .await
    .expect("写入老配置应成功");
}

/// 一档落点的原始 JSON 形状（V0.4.0 的字段名，camelCase）。
fn binding_json(kind: &str, enabled: bool, heading: &str) -> serde_json::Value {
    json!({
        "kind": kind,
        "enabled": enabled,
        "root": USER_ROOT,
        "file": "{date}.md",
        "heading": heading,
    })
}

fn kinds(loaded: &MdSyncConfig) -> Vec<MdSyncKind> {
    loaded.bindings.iter().map(|item| item.kind).collect()
}

/// V0.4.0 用户真实形状的保存值：两档落点、根目录是**他自己挑的** `D:\MyVault`。
///
/// 断言四件事，缺一条就有一个真实用户会踩：
/// 1. `enabled` 保持 true（内核默认关不能把老用户关掉）；
/// 2. `pollSecs` 保持 900；
/// 3. 两档的 `root` 仍是 `D:\MyVault`（**这一条是本用例存在的理由**：
///    `merge_bindings` 只 append 缺席的 kind，一旦有人把它改成
///    「defaults 覆盖 saved」或「先 defaults 后 extend saved」，用户手写的路径
///    就会被默认值悄悄改写，而设置页只会显示新路径、不会有任何提示）；
/// 4. 第三档 `todos` 被补齐，且补的是**完整落点**（root / file / heading 都有值）。
#[tokio::test]
async fn a_legacy_config_keeps_its_custom_root_and_gains_todos() {
    let pool = fresh_pool("md-kernel-root").await;
    seed_raw(
        &pool,
        &json!({
            "enabled": true,
            "pollSecs": 900,
            "bindings": [
                binding_json("timers", true, TIMERS_HEADING),
                binding_json("notes", true, NOTES_HEADING),
            ],
        })
        .to_string(),
    )
    .await;

    let loaded = config::load(&pool).await.expect("老配置应能读回");

    assert!(
        loaded.enabled,
        "老用户存过 enabled:true，不能被内核默认的 false 关掉"
    );
    assert_eq!(
        loaded.poll_secs, 900,
        "用户调过的间隔不能被打回默认 15 分钟"
    );

    assert_eq!(loaded.bindings.len(), 3, "缺的那一档 kind 要补齐");
    assert_eq!(
        loaded.bindings[0].root, USER_ROOT,
        "用户改过的根目录不能被内核默认值覆盖"
    );
    assert_eq!(
        loaded.bindings[1].root, USER_ROOT,
        "第二档的根目录同样不能被覆盖"
    );
    assert_eq!(loaded.bindings[0].heading, TIMERS_HEADING);
    assert_eq!(loaded.bindings[1].heading, NOTES_HEADING);

    let todos = loaded
        .bindings
        .iter()
        .find(|item| item.kind == MdSyncKind::Todos)
        .expect("第三档 todos 应被补齐");
    assert_eq!(todos.root, MD_SYNC_DEFAULT_ROOT);
    assert_eq!(todos.file, MD_SYNC_DEFAULT_FILE);
    assert_eq!(todos.heading, TODOS_HEADING, "补齐的是完整落点，不是空壳");
    assert!(todos.enabled, "补进来的落点默认参与同步");

    /* 保存值在前、补的在后：设置页按这个顺序渲染，顺序变了等于界面顺序变了。 */
    assert_eq!(
        kinds(&loaded),
        vec![MdSyncKind::Timers, MdSyncKind::Notes, MdSyncKind::Todos]
    );
}

/// 用户主动把某一档关掉（`enabled: false`）后，`load` 不能把它补成 true。
///
/// `services/md_sync/config.rs` 里已有一条 `a_disabled_binding_is_not_resurrected`
/// 直接测 `merge_bindings`（纯函数）；这里补的是**同一件事的另一半**：从 DB 读出
/// 那段 JSON 之后结果是否仍为 false。纯函数对、但 `load` 里把 `enabled` 写死成
/// `true` 的改法，纯函数测不出来。
#[tokio::test]
async fn a_disabled_binding_stays_disabled_through_load() {
    let pool = fresh_pool("md-kernel-off").await;
    /* 三档都在（真实形状：设置页只能禁用、不能删除），todos 被用户关掉。 */
    seed_raw(
        &pool,
        &json!({
            "enabled": true,
            "pollSecs": 900,
            "bindings": [
                binding_json("timers", true, TIMERS_HEADING),
                binding_json("notes", true, NOTES_HEADING),
                binding_json("todos", false, TODOS_HEADING),
            ],
        })
        .to_string(),
    )
    .await;

    let loaded = config::load(&pool).await.expect("应能读回");

    let todos = loaded
        .bindings
        .iter()
        .find(|item| item.kind == MdSyncKind::Todos)
        .expect("禁用不等于删除：落点仍要在配置里");
    assert!(
        !todos.enabled,
        "用户关掉的落点不能被默认值重新打开（否则每次启动都偷偷开始写这一档）"
    );
    assert_eq!(loaded.bindings.len(), 3, "不能因为禁用就把它删掉");
    assert_eq!(todos.root, USER_ROOT, "禁用的落点也要保住用户填的路径");
}

/// 老库里的 JSON **没有** `enabled` 字段（升级路径上的真实可能）。
#[tokio::test]
async fn a_legacy_json_without_enabled_loads_as_disabled() {
    let pool = fresh_pool("md-kernel-no-enabled").await;
    seed_raw(
        &pool,
        &json!({
            "pollSecs": 900,
            "bindings": [ binding_json("timers", true, TIMERS_HEADING) ],
        })
        .to_string(),
    )
    .await;

    let loaded = config::load(&pool).await.expect("应能读回");

    assert!(!loaded.enabled, "缺字段 → 视为未开启，不能猜成 true");
    assert_eq!(loaded.poll_secs, 900, "其他字段照常读回");
    /* 老库只有一档：另外两档仍要补齐，顺序不变。 */
    assert_eq!(
        kinds(&loaded),
        vec![MdSyncKind::Timers, MdSyncKind::Notes, MdSyncKind::Todos]
    );
}

/// 一条坏 JSON 不能让设置页打不开：`load` 按「没有保存值」处理，即退回默认**关**。
#[tokio::test]
async fn a_broken_json_falls_back_to_the_disabled_default() {
    let pool = fresh_pool("md-kernel-broken").await;
    seed_raw(&pool, "{ this is not json").await;

    let loaded = config::load(&pool).await.expect("坏 JSON 不该变成错误");

    assert_eq!(loaded, MdSyncConfig::default());
    assert!(
        !loaded.enabled,
        "解析失败按未配置处理 = 关；猜成 true 就等于一条坏数据开始往磁盘写"
    );
}

/// **行为记录**：保存值里出现一个当前版本不认识的 `kind` 时会发生什么。
///
/// `MdSyncKind` 是闭合枚举，未知取值让整段 JSON 反序列化失败；`config::load` 对解析
/// 失败的处理是「当作没有保存值」，于是回落到 `MdSyncConfig::default()`——
/// 总开关 `enabled` 从 `true` 变成 **`false`**，用户调过的 `pollSecs` 与自定义
/// `root` 也一并从**生效配置**里消失（库里的原始 JSON 没被改写，但用户看到的
/// 同步已经停了）。
///
/// 这条不是「测试 bug」也不是「实现 bug」，而是两个各自有理由的决定叠在一起的结果：
/// 「解析失败别让设置页打不开」+「出厂默认关」。写在这里是为了让它**可见**：
/// 触发面很窄（只有升级到更高版本又回退、或手改 `settings` 表才会写出未知 kind），
/// 但后果是静默停同步。若产品希望「一条坏落点不该拖垮全部」，改法是在
/// `load` 里逐条反序列化 `bindings`、跳过不认识的 kind 并保留其余字段。
#[tokio::test]
async fn an_unknown_kind_falls_back_to_the_disabled_default() {
    let pool = fresh_pool("md-kernel-unknown-kind").await;
    let mut unknown = binding_json("timers", true, TIMERS_HEADING);
    unknown["kind"] = serde_json::json!("timers_v2");
    seed_raw(
        &pool,
        &json!({
            "enabled": true,
            "pollSecs": 900,
            "bindings": [ unknown ],
        })
        .to_string(),
    )
    .await;

    let loaded = config::load(&pool).await.expect("坏 kind 不该让 load 报错");

    println!(
        "[unknown-kind] enabled={} pollSecs={} 首档 root={}",
        loaded.enabled, loaded.poll_secs, loaded.bindings[0].root
    );

    /* 当前行为：整份回落到默认值 —— 总开关被关、用户的 900 与 D:/MyVault 不再生效。 */
    assert_eq!(loaded, MdSyncConfig::default(), "解析失败 → 当作没有保存值");
    assert!(
        !loaded.enabled,
        "注意：用户原本 enabled:true，这里被静默关掉（见本用例注释）"
    );
    assert_eq!(
        loaded.poll_secs, 900,
        "回落后的 900 来自 Default，不是用户保存值（两者恰好同值）"
    );
    assert_ne!(
        loaded.bindings[0].root, USER_ROOT,
        "用户自定义根目录不再出现在生效配置里"
    );

    /* 原始 JSON 没有被改写：这是「静默」而非「数据丢失」的那一半。 */
    let raw = settings::get_value(&pool, config::CONFIG_KEY)
        .await
        .expect("读 KV 应成功")
        .expect("保存值仍在");
    assert!(raw.contains("timers_v2"), "库里的原文原样保留：{raw}");
}
