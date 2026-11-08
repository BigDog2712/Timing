//! QA 独立验收 · 「老用户的云端配置一个字节都不许丢」
//! （PRD A3 / A4 / C2 / §13.4.1 的后端半场；[V0.11.26] 双通路改造后按新形状复验）
//!
//! ## 为什么前端那条 `mdSyncV0118Fidelity.test.tsx` 还不够
//!
//! 前端测试里 `mdSyncApi.save` 是 mock，最多证明「发出去的字节对」。真正不可逆的是
//! `settings` 表里那份 JSON —— 它一旦被改写，用户的坚果云地址 / 落点 / 账号就永久没了
//! （没有「撤销」，也没有第二次机会：下一次 `config::load` 读到的是被改过的那份）。
//!
//! 所以本文件走**真实链路**，并且用主人的**活库原串**当夹具：
//!
//! ```text
//! 把活库里那一串 JSON（legacy `cloud` 单键）原样写进 settings
//!   → config::load（读时推断：老键在内存里折算成两条通路，磁盘零写）
//!   → config::save（新形状落库、不再出现 legacy `cloud` 键）
//!   → 再 load → save 一次，逐字节相同
//! ```
//!
//! ## 为什么比整串而不是逐字段
//!
//! 逐字段（`md_sync_no_touch_save.rs` 的口径）挡不住三种真实的破坏：
//! ① 键序变了（同一份数据、不同的字符串，前端 `draft` 回填与 diff 都靠对象形状）；
//! ② 多出一个键 `"extra":null`；③ 少一个键（`#[serde(default)]` 会让它**静默**读成
//! 默认值，用户看到的是「地址被清空了」而没有任何报错）。整串比对把这三类一起兜住。
//!
//! ## 本文件钉住的四件事
//!
//! 1. `load` **不写盘**（读一次之后 `settings` 里的原串不变）；
//! 2. 迁移保存是**一次性的**：第一次 `save` 把 legacy `cloud` 折算成两条通路、
//!    往后任何一次「什么都没改的保存」都**逐字节不变**（含中文路径 / `%USERPROFILE%` / 邮箱）；
//! 3. 关掉一条通路只改那一个布尔，其余字段逐字不变，切回来还是那一串（A3 / A4）；
//! 4. `cloud: null` 与「键不存在」都不能被补成空壳（§11 坑 2）。

use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::repositories::settings;
use crate::services::md_sync::config;
use crate::tests::support::fresh_pool;

/// 主人活库 `settings.plugin.md-sync.config` 的**逐字**内容（V0.11.18 验收当天读取）。
///
/// 三个坑都在这串里，缺一个夹具就少验一个：
/// - `root` 里 `%USERPROFILE%` + **中文目录名**（`应用/remotely-save/Elio/1-MemeX/Diary`）；
/// - `localRoot` 是**中文**路径（`我的坚果云`）；
/// - `user` 是邮箱（`@` 与 `.` 在 JSON 里不特殊，但在 URL / 正则里特殊）。
///
/// 三档落点**不同**（前两档 OneDrive 日记，待办走 `%APP_DIR%\md`）—— 这正是
/// 「一次误扇出就毁两档」的形状。
const LIVE_JSON: &str = r#####"{"enabled":true,"pollSecs":900,"bindings":[{"kind":"timers","enabled":true,"root":"%USERPROFILE%\\OneDrive\\应用\\remotely-save\\Elio\\1-MemeX\\Diary","file":"{date}.md","heading":"#### 事项计时"},{"kind":"notes","enabled":true,"root":"%USERPROFILE%\\OneDrive\\应用\\remotely-save\\Elio\\1-MemeX\\Diary","file":"{date}.md","heading":"#### 便利贴"},{"kind":"todos","enabled":true,"root":"%APP_DIR%\\md","file":"{date}.md","heading":"#### 待办事项"}],"cloud":{"enabled":true,"mode":"localfolder","localRoot":"C:\\Users\\49801\\Nutstore\\1\\我的坚果云\\Timing","baseUrl":"https://dav.jianguoyun.com/dav/","basePath":"/Timing","user":"498019678@qq.com"}}"#####;

/// 一条通路里「一个字节都不许变」的字段（`enabled` 是开关位，允许变）。
const CHANNEL_FIELDS: [&str; 4] = ["localRoot", "baseUrl", "basePath", "user"];

async fn seed(pool: &sqlx::SqlitePool, raw: &str) {
    settings::set_value(pool, config::CONFIG_KEY, raw, crate::platform::clock::now_ms())
        .await
        .expect("写入主人配置应成功");
}

async fn raw_of(pool: &sqlx::SqlitePool) -> String {
    settings::get_value(pool, config::CONFIG_KEY)
        .await
        .expect("读配置应成功")
        .expect("配置键必须存在")
}

/// **主判据**：迁移只发生一次，之后 `load → save` 逐字节不变。
///
/// 这条红了的含义很具体：用户下次打开设置页，坚果云地址 / 目录 / 账号里至少有一项
/// 已经不是他填的那个了（或者每次保存都在改写文件，diff 永远不收敛）。
#[tokio::test]
async fn load_then_save_keeps_the_live_config_byte_identical() {
    let pool = fresh_pool("qa-live-roundtrip").await;
    seed(&pool, LIVE_JSON).await;

    let loaded = config::load(&pool).await.expect("load 应成功");
    config::save(&pool, &loaded).await.expect("save 应成功");
    let once = raw_of(&pool).await;

    /* 新保存形：legacy `cloud` 键消失（O11），两条通路各一份，用户的字段一个不丢。 */
    assert!(
        !once.contains(r#""cloud":"#),
        "新保存形里不许再出现 legacy `cloud` 键：{once}"
    );
    assert!(once.contains("cloudFolder"), "folder 通路必须物化出来：{once}");
    assert!(once.contains("我的坚果云"), "迁移把用户填的中文目录弄丢了：{once}");
    assert!(once.contains("498019678@qq.com"), "迁移把账号弄丢了：{once}");

    /* 幂等：第二次什么都没改的保存必须逐字节相同。 */
    let again = config::load(&pool).await.expect("load 应成功");
    config::save(&pool, &again).await.expect("save 应成功");
    assert_eq!(
        raw_of(&pool).await,
        once,
        "第二次「什么都没改的保存」改写了用户的配置（逐字节比对失败）"
    );
}

/// 判据 1：`load` 是**只读**的。
///
/// 读一次配置就把原串换个形状（补默认值、重排键、trim）是升级事故的经典开场：
/// 用户只是打开了一次设置页，文件就已经不是他原来那份了。
///
/// [V0.11.26] 读时推断（把 legacy `cloud` 折算成两条通路）刻意只在**内存**里做，
/// 所以这条在双通路改造后仍然是硬判据：磁盘要等到用户真的保存才动。
#[tokio::test]
async fn load_never_writes_the_settings_row() {
    let pool = fresh_pool("qa-load-readonly").await;
    seed(&pool, LIVE_JSON).await;

    for _ in 0..3 {
        let _ = config::load(&pool).await.expect("load 应成功");
        assert_eq!(
            raw_of(&pool).await,
            LIVE_JSON,
            "`config::load` 不许改写 settings（读的时候不改盘）"
        );
    }
}

/// 判据 3（A3 / A4）：关掉一条通路 = 只有那个布尔变，其余字段逐字不变；切回来还是那一串。
#[tokio::test]
async fn going_local_only_moves_the_channel_bit_and_nothing_else() {
    let pool = fresh_pool("qa-channel-off").await;
    seed(&pool, LIVE_JSON).await;

    let loaded = config::load(&pool).await.expect("load 应成功");
    let before = loaded.cloud_folder.clone().expect("夹具里 folder 通路必须物化");
    config::save(&pool, &loaded).await.expect("save 应成功");
    /* 迁移后的那一串，作为「切出去再切回来」的对照（老形状不会回写，这是 PRD §4.4 的设计）。 */
    let migrated = raw_of(&pool).await;

    let mut off = loaded.clone();
    off.cloud_folder = Some(MdSyncCloudChannel {
        enabled: false,
        ..before.clone()
    });
    config::save(&pool, &off).await.expect("save 应成功");

    let mut back = config::load(&pool).await.expect("load 应成功");
    let after = back
        .cloud_folder
        .clone()
        .expect("关掉开关**不许**把通路配置删掉（CH4）");
    assert!(!after.enabled, "开关位必须真的变成「不用本地」");
    for field in CHANNEL_FIELDS {
        let got = serde_json::to_value(after.clone())
            .unwrap()
            .get(field)
            .cloned()
            .unwrap();
        let want = serde_json::to_value(before.clone())
            .unwrap()
            .get(field)
            .cloned()
            .unwrap();
        assert_eq!(got, want, "`{field}` 被关开关改掉了（A3：一个字节都不许变）");
    }

    /* 再打开：地址 / 目录 / 账号一个都不用重填，落库回到迁移后的那一串（A4）。 */
    back.cloud_folder = Some(MdSyncCloudChannel { enabled: true, ..after });
    config::save(&pool, &back).await.expect("save 应成功");
    assert_eq!(
        raw_of(&pool).await,
        migrated,
        "关掉再打开，配置必须回到原样的那一串（A4）"
    );
}

/// 判据 4：`cloud: null` 与「键不存在」都**不许**被补成空壳（§11 坑 2 / PRD A1h）。
///
/// [V0.11.26] 空壳的形状变了（不再是一个 `cloud`，而是 `cloudFolder` + `cloudWebdav`
/// 两个 `{enabled:false,...}`），判据不变：两条通路都不许凭空长出来。
#[tokio::test]
async fn null_cloud_is_never_fattened_into_a_default_shell() {
    /* 形状 A：键存在、值是 null（老前端「切一下再切回来」会发出这一形状） */
    let pool = fresh_pool("qa-null-cloud").await;
    let nulled = LIVE_JSON.replace(
        r#""cloud":{"enabled":true,"mode":"localfolder","localRoot":"C:\\Users\\49801\\Nutstore\\1\\我的坚果云\\Timing","baseUrl":"https://dav.jianguoyun.com/dav/","basePath":"/Timing","user":"498019678@qq.com"}"#,
        r#""cloud":null"#,
    );
    assert!(nulled.contains(r#""cloud":null"#), "夹具替换失败，用例会假绿");
    seed(&pool, &nulled).await;

    let loaded = config::load(&pool).await.expect("load 应成功");
    assert!(loaded.cloud.is_none(), "`cloud: null` 必须读成 None，不许补默认值");
    assert!(loaded.cloud_folder.is_none(), "null 不许物化出 folder 通路");
    assert!(loaded.cloud_webdav.is_none(), "null 不许物化出 webdav 通路");
    config::save(&pool, &loaded).await.expect("save 应成功");
    let raw = raw_of(&pool).await;
    assert!(!raw.contains("cloudFolder"), "落库不许长出空壳：{raw}");
    assert!(!raw.contains("cloudWebdav"), "落库不许长出空壳：{raw}");
    assert!(
        !raw.contains("dav.jianguoyun.com"),
        "凭空给新用户填了默认地址（块④ 会从此默认展开）：{raw}"
    );

    /* 形状 B：老配置里**根本没有** `cloud` 这个键（V0.11.12 及以前） */
    let pool2 = fresh_pool("qa-absent-cloud").await;
    let cut = LIVE_JSON.find(r#","cloud":"#).expect("夹具里必须有 cloud 键");
    let absent = format!("{}}}", &LIVE_JSON[..cut]);
    seed(&pool2, &absent).await;
    let loaded2 = config::load(&pool2).await.expect("load 应成功");
    assert!(loaded2.cloud.is_none(), "缺键必须读成 None");
    assert!(loaded2.cloud_folder.is_none() && loaded2.cloud_webdav.is_none());
    config::save(&pool2, &loaded2).await.expect("save 应成功");
    let raw2 = raw_of(&pool2).await;
    assert!(
        !raw2.contains("dav.jianguoyun.com"),
        "缺键的老配置保存后不许长出默认云端地址"
    );
    assert!(!raw2.contains("cloudFolder") && !raw2.contains("cloudWebdav"));
}

/// 判据 2 的补充：`pollSecs` 不是「被界面改回去」的那个字段。
///
/// C2 要求「老用户的 `pollSecs` 是他原来的值，保存其它字段后仍不变」。界面上确实还有
/// 一个间隔输入框（批 1 才删），所以这条必须在**后端**再钉一次：任何保存路径都不得让
/// 900 变成 15 分钟默认值。
#[tokio::test]
async fn poll_secs_survives_a_save_that_only_touches_the_channel() {
    let pool = fresh_pool("qa-poll-secs").await;
    seed(&pool, LIVE_JSON).await;

    let mut loaded = config::load(&pool).await.expect("load 应成功");
    loaded.cloud_folder = loaded
        .cloud_folder
        .map(|channel| MdSyncCloudChannel { enabled: false, ..channel });
    config::save(&pool, &loaded).await.expect("save 应成功");

    let after = config::load(&pool).await.expect("load 应成功");
    assert_eq!(after.poll_secs, 900, "老用户的间隔被改成默认值了");
    assert_eq!(after.bindings.len(), 3, "三档落点不许少");
    assert_eq!(after.bindings[2].root, r"%APP_DIR%\md", "待办那一档的落点被改了");
    let folder = after.cloud_folder.expect("folder 通路不许被删掉（CH4）");
    assert_eq!(
        folder.local_root,
        r"C:\Users\49801\Nutstore\1\我的坚果云\Timing",
        "本地落点被改了"
    );
}
