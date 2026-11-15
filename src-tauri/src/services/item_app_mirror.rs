//! 存量「事项 ↔ 应用」绑定的**启动补镜像**（[0.13 fix]「我启动了燕云，但没开始计时」）。
//!
//! ## 为什么需要它（不补的话，修完之后老用户仍然不计时）
//!
//! 分析窗里「应用 → 事项」的绑定写的是**它自己的配置表**（`__app_item_binding::<exe>`
//! = `{"itemId":N}`，以及 `__app_override::<exe>` 里的 `itemBindings[]`），而药丸的
//! 「切到绑定的应用就自动接管计时」读的是业务库的 `item_app` 表。本轮之前**没有任何
//! 代码**往 `item_app` 写过行：`legacy_bindings::backfill` 有实现、有 IPC 命令、有前端
//! 封装，但那个封装**零调用方**（守卫键也早就躺在库里），所以老用户的绑定只存在于配置表。
//!
//! 前端的即时镜像（保存那一刻发 `sync_app_item_bindings`）只覆盖**修完之后的新保存**。
//! 报障人的配置是修之前建的，而且他是**直接开游戏**（既没开应用卡、也没开事项编辑面板），
//! 所以必须有一条「什么都不打开也会发生」的路径 —— 就是这里：启动时补一次。
//!
//! ## 两个库（这一条写错过一次，别再写错）
//!
//! 配置表在**分析窗自己的库**（`patina.db`，见 `infra::activity::storage_paths::
//! SQLITE_DB_FILE_NAME`），`item_app` 在**业务库**（`timing.db`，`db::init_pool`）。
//! 两个文件、两个 `SqlitePool`。拿业务池去读配置表的症状是**恒空 + 全绿**：
//! `get_all` 在 timing.db 的 `settings` 表上查不到任何 `__app_item_binding::%`，
//! `inserted` 永远 0，日志永远不打，用户直接开游戏仍然不计时 —— 与本次报障一模一样。
//! 所以本模块的入口一律收两个池：`kv` 只读、`business` 只写。对照 `legacy_bindings::backfill
//! (business, activity, now)` 的既有两池形态。
//!
//! ## 三条口径（改之前先读）
//!
//! 1. **只增不减**：只补缺失的 `(item_id, app_key)` 行，**从不删除**，也不改已有行的
//!    `track`。删除只发生在用户当下的保存动作里（那里知道他想要什么），启动期猜不出来；
//!    一旦这里也删，就会与"我刚解绑的那一条"打架。
//!
//!    由此推出一条**约束**（P0-3，改前端时必读）：本模块的唯一数据源是配置表 KV，
//!    所以「用户解绑了」这件事**必须由保存路径把 KV 也清掉**（分析窗
//!    `clearAppItemBinding`：先删 `__app_item_binding::<exe>`，再发全集让宿主解绑）。
//!    KV 留着、只删了 `item_app` 的行，下次开机这里会**原样补回来** —— 用户看到的是
//!    「开关坏了」。两条用例钉住这条边界：`deleted_row_is_not_restored_after_the_kv_is_cleared`
//!    与 `row_comes_back_while_the_kv_still_holds_it`。
//! 2. **窄口径，不碰分类**：只认 `itemBindings[]`，**不**复用 `legacy_bindings::backfill`
//!    —— 那条会顺带把配置表里的分类数组重新灌进活动库 `app_category`，把用户刚在映射
//!    视图里调过的顺序覆盖回去。
//! 3. **单事项键优先**：同一个应用在两份配置里都出现时，`__app_item_binding::`（应用卡
//!    「绑定事项」写的那份，也是前端即时镜像的载荷）说了算；`__app_override::` 只补它
//!    没覆盖的应用。合并规则只有这一处，否则前端即时镜像与这里的启动补丁会各说一套。
//!
//!    但**「不计入」（`track: false`）不属于"口径 3 让位"的那部分**：它是用户的明确决定，
//!    从哪份配置读到的都得保住。所以单事项键写进 `wanted` 时用的是"这个应用在 override 里
//!    有没有标过不计入"（`track_off` 集合），而不是恒 `track = 1` —— 否则同一应用只要在
//!    应用卡上绑过一条，每次开机都会把"仅观察"翻回"计入"。与前端
//!    `loadAppItemBindingUnions` 的 `trackOff` 用 **OR** 合并是同一条口径（前端那份注释里
//!    写了为什么只能 OR：归一后成员 exe 与父应用是同一个统计应用，没法只对成员生效）。
//!    注意这只影响**新插入**的行：已有行一律不改 `track`（口径 1），那条别动。
//!
//! ## 失败与副作用
//!
//! 只记日志、不阻断启动、**不打 `dirty::mark`**（L8：业务写入信号只许出现在
//! `commands/`）。代价是 md 同步要等下一次用户写入才看到这批绑定 —— 值得：绑定是派生
//! 事实，而在启动期打同步信号会让「刚开机就全量重扫」变成常态。
//!
//! 桌面独占：`app_key` 的归一实现（`models::activity::activity_read_model::normalize_app_key`）
//! 与分析窗配置表都只在桌面存在；手机端没有前台窗口这条链路，也没有消费者。

use std::collections::{BTreeMap, BTreeSet, HashMap};

use sqlx::SqlitePool;

use crate::models::activity::activity_read_model::normalize_app_key;
use crate::repositories::settings as settings_repo;
use crate::services::item_app;

/// 单事项键（应用排行卡「绑定事项」+ 本轮的「绑定应用」一栏都写它）
const APP_ITEM_BINDING_PREFIX: &str = "__app_item_binding::";
/// 应用设置弹窗的多事项配置（只取 `itemBindings[]`，**不碰** `categories[]`）
const APP_OVERRIDE_PREFIX: &str = "__app_override::";

/// 补镜像的结果（`inserted` 是真正新增的行数；`skipped` 含已存在 / 事项已删 / 脏配置）。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct MirrorReport {
    pub inserted: usize,
    pub skipped: usize,
}

/// 单事项键的值：`{"itemId":N}`。脏值 / 非正整数一律当"没有"（不阻断别的绑定）。
fn parse_item_id(raw: &str) -> Option<i64> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let item_id = value.get("itemId")?.as_i64()?;
    (item_id > 0).then_some(item_id)
}

/// 多事项配置的值：取 `itemBindings[].itemId`，`track === false` 视为「仅观察」。
///
/// 没有 `itemBindings` 字段 = 这个应用没有绑事项（返回 `None`，调用方跳过整条）。
fn parse_override_bindings(raw: &str) -> Option<(Vec<i64>, i64)> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let track = match value.get("track").and_then(|flag| flag.as_bool()) {
        Some(false) => 0,
        _ => 1,
    };
    let item_ids = value
        .get("itemBindings")?
        .as_array()?
        .iter()
        .filter_map(|row| row.get("itemId")?.as_i64())
        .filter(|item_id| *item_id > 0)
        .collect::<Vec<_>>();
    Some((item_ids, track))
}

/// 配置表全表 → `app_key → {item_id: track}`（口径 3：单事项键覆盖同一应用）。
fn collect_wanted(rows: &HashMap<String, String>) -> BTreeMap<String, BTreeMap<i64, i64>> {
    let mut wanted: BTreeMap<String, BTreeMap<i64, i64>> = BTreeMap::new();
    /* 这个应用有没有被标过「不计入」。只在**新插入**时用（口径 1：已有行不改 track）。 */
    let mut track_off: BTreeSet<String> = BTreeSet::new();
    for (key, raw) in rows {
        let Some(exe) = key.strip_prefix(APP_OVERRIDE_PREFIX) else {
            continue;
        };
        let Some(app_key) = normalize_app_key(exe) else {
            continue;
        };
        let Some((item_ids, track)) = parse_override_bindings(raw) else {
            continue;
        };
        if item_ids.is_empty() {
            continue;
        }
        if track == 0 {
            track_off.insert(app_key.clone());
        }
        let slot = wanted.entry(app_key).or_default();
        for item_id in item_ids {
            slot.insert(item_id, track);
        }
    }
    for (key, raw) in rows {
        let Some(exe) = key.strip_prefix(APP_ITEM_BINDING_PREFIX) else {
            continue;
        };
        let Some(app_key) = normalize_app_key(exe) else {
            continue;
        };
        let Some(item_id) = parse_item_id(raw) else {
            continue;
        };
        /* 口径 3 覆盖的是**哪些事项**，不是"计不计入"：应用在 override 里标了 `track: false`
           时，1:1 这一路补出来的行也必须带 `track = 0`，否则每次开机把用户的"仅观察"翻回
           接管。用例 `single_item_key_keeps_the_track_off_flag`。 */
        let track = if track_off.contains(&app_key) { 0 } else { 1 };
        wanted.insert(app_key, BTreeMap::from([(item_id, track)]));
    }
    wanted
}

/// 补一次镜像。**只增不减**：已存在的 `(item_id, app_key)` 一律跳过（也不改 `track`）。
///
/// `kv` = 分析窗配置表所在库（只读）；`business` = 业务库（`item_app` 在这里，只写）。
pub async fn mirror(business: &SqlitePool, kv: &SqlitePool) -> Result<MirrorReport, String> {
    let rows = settings_repo::get_all(kv).await.map_err(|err| err.to_string())?;
    let mut report = MirrorReport::default();
    for (app_key, items) in collect_wanted(&rows) {
        let existing = match item_app::list_for_app(business, &app_key).await {
            Ok(rows) => rows,
            /* 应用键脏（空 / 只有引号）：这一条跳过，别连累别的绑定 */
            Err(_) => {
                report.skipped += items.len();
                continue;
            }
        };
        for (item_id, track) in items {
            if existing.iter().any(|row| row.item_id == item_id) {
                report.skipped += 1;
                continue;
            }
            match item_app::bind(business, item_id, &app_key, Some(track)).await {
                Ok(_) => report.inserted += 1,
                /* 事项已删除 / id 脏：跳过。这里是启动路径，绝不能因为一条坏配置让开机失败。 */
                Err(_) => report.skipped += 1,
            }
        }
    }
    Ok(report)
}

/// 启动时补一次（`bootstrap` 里调）。必须 `spawn`：`bootstrap` 跑在主线程上，
/// 同步等一次库往返没必要，而失败只记日志这条通路也不值得让它挡住窗口创建。
///
/// **为什么分析窗库要 `wait_for_sqlite_pool` 而不是 `app.state()`**：
/// `app::bootstrap::setup` 先于 `services::activity::bootstrap::setup`（`lib.rs` 的顺序），
/// 到这里分析窗的池**通常还没建**。`wait_for_sqlite_pool` 每 100ms 重试、最多 30s
/// （`sqlite_pool.rs:726`），拿不到就只记一条 warn 放弃 —— 下一次启动还会再来。
pub fn mirror_on_boot<R: tauri::Runtime>(app: &tauri::AppHandle<R>, business: &SqlitePool) {
    let app = app.clone();
    let business = business.clone();
    tauri::async_runtime::spawn(async move {
        let kv = match crate::services::activity::data::sqlite_pool::wait_for_sqlite_pool(&app).await {
            Ok(pool) => pool,
            Err(err) => {
                crate::log_warn!("item_app 启动补镜像：分析窗库未就绪（{err}）");
                return;
            }
        };
        match mirror(&business, &kv).await {
            Ok(report) if report.inserted > 0 => {
                crate::log_info!(
                    "item_app 启动补镜像：补 {} 条，跳过 {} 条",
                    report.inserted,
                    report.skipped
                );
            }
            Ok(_) => {}
            Err(err) => crate::log_warn!("item_app 启动补镜像失败：{err}"),
        }
    });
}
