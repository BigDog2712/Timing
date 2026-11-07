//! QA 独立验收 · V0.11.18 批 0：「老用户的云端配置一个字节都不许丢」
//! （PRD A3 / A4 / C2 / §13.4.1 的后端半场）
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
//! 把活库里那一串 JSON 原样写进 settings
//!   → config::load（打开设置页拿到的 config）
//!   → config::save（"什么都没改" 时前端原样回传的那一份）
//!   → 再读 settings 的原始字符串，与夹具**逐字节**比
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
//! 2. `load → save` 后原串**逐字节不变**（含中文路径 / `%USERPROFILE%` / 邮箱 / `https://`）；
//! 3. `enabled: false` 只改那一个字节，其余五个字段逐字不变（A3）；
//! 4. `cloud: null` 与「键不存在」是两种历史状态，都不能被补成空壳（§11 坑 2）。

use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
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

/// 云端五个「一个字节都不许变」的字段（`enabled` 是通道位，允许变）
const CLOUD_FIELDS: [&str; 5] = ["mode", "localRoot", "baseUrl", "basePath", "user"];

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

/// **主判据**：`load → save` 之后原串逐字节不变。
///
/// 这条红了的含义很具体：用户下次打开设置页，坚果云地址 / 目录 / 账号里至少有一项
/// 已经不是他填的那个了。
#[tokio::test]
async fn load_then_save_keeps_the_live_config_byte_identical() {
    let pool = fresh_pool("qa-live-roundtrip").await;
    seed(&pool, LIVE_JSON).await;

    let loaded = config::load(&pool).await.expect("load 应成功");
    config::save(&pool, &loaded).await.expect("save 应成功");

    assert_eq!(
        raw_of(&pool).await,
        LIVE_JSON,
        "一次「什么都没改的保存」改写了用户的云端配置（逐字节比对失败）"
    );
}

/// 判据 1：`load` 是**只读**的。
///
/// 读一次配置就把原串换个形状（补默认值、重排键、trim）是升级事故的经典开场：
/// 用户只是打开了一次设置页，文件就已经不是他原来那份了。
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

/// 判据 3（A3）：切到「只用本地」= 只有 `cloud.enabled` 这一个布尔变，其余五个字段逐字不变。
#[tokio::test]
async fn going_local_only_moves_the_channel_bit_and_nothing_else() {
    let pool = fresh_pool("qa-channel-off").await;
    seed(&pool, LIVE_JSON).await;

    let mut loaded = config::load(&pool).await.expect("load 应成功");
    let before = loaded.cloud.clone().expect("夹具里云端必须存在");
    loaded.cloud = Some(MdSyncCloud {
        enabled: false,
        ..before.clone()
    });
    config::save(&pool, &loaded).await.expect("save 应成功");

    let mut back = config::load(&pool).await.expect("load 应成功");
    let after = back.cloud.clone().expect("切到只用本地**不许**把云端配置删掉（CH4）");
    assert!(!after.enabled, "通道位必须真的变成「只用本地」");
    for field in CLOUD_FIELDS {
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
        assert_eq!(got, want, "`{field}` 被切通道改掉了（A3：一个字节都不许变）");
    }
    /* 再切回「本地 + 云端」：地址 / 目录 / 账号一个都不用重填（A4） */
    back.cloud = Some(MdSyncCloud {
        enabled: true,
        ..after
    });
    config::save(&pool, &back).await.expect("save 应成功");
    assert_eq!(
        raw_of(&pool).await,
        LIVE_JSON,
        "切出去再切回来，配置必须回到原样的那一串（A4）"
    );
}

/// 判据 4：`cloud: null` 与「键不存在」都**不许**被补成空壳（§11 坑 2 / PRD A1h）。
///
/// 落了空壳的后果不是「多一个字段」：`cloudConfigured` 变 `true` → 块④ 从此默认展开 →
/// 从没配过云端的新用户一进设置页就看见六个输入框，而里面填的是我们替他猜的地址。
#[tokio::test]
async fn null_cloud_is_never_fattened_into_a_default_shell() {
    /* 形状 A：键存在、值是 null（前端「本地 + 云端 点一下再点回来」会发出这一形状） */
    let pool = fresh_pool("qa-null-cloud").await;
    let nulled = LIVE_JSON.replace(
        r#""cloud":{"enabled":true,"mode":"localfolder","localRoot":"C:\\Users\\49801\\Nutstore\\1\\我的坚果云\\Timing","baseUrl":"https://dav.jianguoyun.com/dav/","basePath":"/Timing","user":"498019678@qq.com"}"#,
        r#""cloud":null"#,
    );
    assert!(nulled.contains(r#""cloud":null"#), "夹具替换失败，用例会假绿");
    seed(&pool, &nulled).await;

    let loaded = config::load(&pool).await.expect("load 应成功");
    assert!(loaded.cloud.is_none(), "`cloud: null` 必须读成 None，不许补默认值");
    config::save(&pool, &loaded).await.expect("save 应成功");
    let raw = raw_of(&pool).await;
    assert!(raw.contains(r#""cloud":null"#), "落库必须仍是 null：{raw}");
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
    config::save(&pool2, &loaded2).await.expect("save 应成功");
    assert!(
        !raw_of(&pool2).await.contains("dav.jianguoyun.com"),
        "缺键的老配置保存后不许长出默认云端地址"
    );
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
    loaded.cloud = loaded.cloud.map(|cloud| MdSyncCloud { enabled: false, ..cloud });
    config::save(&pool, &loaded).await.expect("save 应成功");

    let after = config::load(&pool).await.expect("load 应成功");
    assert_eq!(after.poll_secs, 900, "老用户的间隔被改成默认值了");
    assert_eq!(after.bindings.len(), 3, "三档落点不许少");
    assert_eq!(after.bindings[2].root, r"%APP_DIR%\md", "待办那一档的落点被改了");
    assert_eq!(
        after.cloud.map(|cloud| cloud.mode),
        Some(CloudMode::LocalFolder),
        "云端的载体（localfolder）被改了"
    );
}
