//! [批 2 · 决策 2] 「定时备份」不许再自己跑 —— 两条源码哨兵。
//!
//! 背景：远端备份的设置页随第一批删除（15 条命令下线），但调度链还在（`tick` 的
//! `run_lock` 被两条 WebDAV 配置命令借去保护写入）。于是危险变成「**UI 没了、后台还在传**」。
//!
//! 断点选在配置读取：`load_or_create_config` 恒返回 `enabled: false`，`tick` 每轮都走
//! `SchedulerAction::Idle`。为什么用源码哨兵而不是行为测试：要观测「启动后没有上传」，
//! 得真起一个 AppHandle + 真 WebDAV 服务器 + 真等一个调度窗口，跑不动；能钉住的是
//! 「这条路上不再出现读库那一跳」。代价是约束写法，所以每条只钉「不许回到哪条路」。
//!
//! 判据（命令行可复核）：
//! ```text
//! git grep -n "repository::load_config" -- src-tauri/src/services/insight/data/scheduled_backup.rs
//! ```
//! 现在只剩 `refresh_webdav_target_after_settings_change` 那一处 —— 它只改 target/代次，
//! **不发任何请求**；而它只在 `tick` 已经读到 WebDav 目标时才会被调，而那个目标现在恒为空。

const SCHEDULED_BACKUP_RS: &str = include_str!("../services/insight/data/scheduled_backup.rs");

/// 按大括号配对切出函数体（签名必须逐字可 `find`，包含 `(`）。
fn function_body(source: &str, signature: &str) -> String {
    let start = source
        .find(signature)
        .unwrap_or_else(|| panic!("找不到函数签名 `{signature}`"));
    let mut depth = 0_i32;
    let mut body = String::new();
    for ch in source[start..].chars() {
        if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                body.push(ch);
                return body;
            }
        }
        if depth > 0 {
            body.push(ch);
        }
    }
    panic!("函数体没有闭合：{signature}");
}

#[test]
fn the_runtime_never_reads_or_writes_the_persisted_schedule() {
    let body = function_body(SCHEDULED_BACKUP_RS, "async fn load_or_create_config(");
    assert!(
        !body.contains("repository::load_config"),
        "调度链又去读库里的 `scheduled_backup_config` 了 —— 老用户那条 `enabled: true`\n\
         会立刻复活，启动即在后台往 WebDAV 上传（设置页已经不存在，用户无法关掉它）。\n\
         要让定时备份回来，先把设置页一起恢复。\n函数体：\n{body}"
    );
    assert!(
        !body.contains("repository::save_config"),
        "读配置顺带写库也不行：后台会把用户的配置改写成默认值。\n函数体：\n{body}"
    );
    assert!(
        body.contains("enabled: false"),
        "这个函数必须**恒**返回未启用：\n{body}"
    );
}

#[test]
fn tick_stops_at_a_disabled_config_before_claiming_a_run() {
    let body = function_body(SCHEDULED_BACKUP_RS, "pub async fn tick(");
    assert!(
        body.contains("if !config.enabled"),
        "`tick` 少了「未启用就返回」那道闸 —— 它后面紧跟 claim / execute / upload。\n函数体：\n{body}"
    );
    assert!(
        body.contains("return Ok(false)"),
        "未启用时必须以 `Ok(false)`（Idle）返回，而不是继续往下走。\n函数体：\n{body}"
    );
}
