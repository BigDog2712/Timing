//! [T05] 迁移**时机**的源码哨兵（M-9）。
//!
//! 为什么只能钉源码：要观测「窗口在迁移之前被创建」，得真起一个 AppHandle 并让 WebView2
//! 打开 profile —— 那是真机演练（S6）的事，跑不到单测里。能钉住的是**顺序**这件事本身：
//!
//! ```text
//! portable_boot::prepare   ← 数据根在这里被注入（迁移的入参靠它）
//! activity_dir_migrate     ← 必须在这之后（拿得到数据根）
//! tauri::Builder::default  ← 必须在这之前（窗口一建起来就晚了）
//! ```
//!
//! 晚于 `Builder::default()` 的后果是静默的：`mini_window` / `tool_notifications` 的
//! `.data_directory()` 先在新路径建出一份空 profile，此后 `fs::rename` 要么失败（目标非空）、
//! 要么把老 profile 挤掉 ⇒ 用户 mini 窗/通知窗偏好回默认一次，而日志里只有一句 warn。
//!
//! 反过来早于 `portable_boot::prepare` 也不行：那时 `data_root()` 还是**默认值**，
//! 迁移会去动一个用户并没在用的目录。

const LIB_RS: &str = include_str!("../lib.rs");

fn line_of(needle: &str) -> usize {
    LIB_RS
        .lines()
        .position(|line| line.contains(needle))
        .unwrap_or_else(|| panic!("lib.rs 里找不到 `{needle}`"))
        + 1
}

#[test]
fn the_migration_runs_between_the_data_root_injection_and_the_builder() {
    let data_root = line_of("app::portable_boot::prepare(");
    let migration = line_of("app::activity_dir_migrate::prepare(");
    let builder = line_of("let builder = tauri::Builder::default();");

    assert!(
        data_root < migration,
        "迁移必须排在 `portable_boot::prepare` 之后（否则 `data_root()` 还是默认值）：\
         portable_boot 在 {data_root} 行，迁移在 {migration} 行"
    );
    assert!(
        migration < builder,
        "迁移必须排在 `tauri::Builder::default()` 之前（否则窗口已在新路径建出空 profile，\
         rename 要么失败要么把老 profile 挤掉）：迁移在 {migration} 行，Builder 在 {builder} 行"
    );
}

/// 迁移的入参必须是**注入之后**的 `data_root()`，不是 `%APPDATA%` 或任何常量拼出来的路径。
#[test]
fn the_migration_is_given_the_configured_data_root() {
    let call = LIB_RS
        .lines()
        .find(|line| line.contains("app::activity_dir_migrate::prepare("))
        .expect("找不到迁移调用行");
    assert!(
        call.contains("platform::app_dir::data_root()"),
        "迁移必须拿到 `platform::app_dir::data_root()`（用户可能把数据根挪到别的盘）：{call}"
    );
}

/// 迁移**不许**返回 `Result` 让调用方 `?` —— 失败必须自己 fail-open 并继续启动。
#[test]
fn the_migration_never_blocks_startup() {
    let call = LIB_RS
        .lines()
        .find(|line| line.contains("app::activity_dir_migrate::prepare("))
        .expect("找不到迁移调用行");
    assert!(
        !call.contains('?'),
        "迁移返回 `Result` 被 `?` 透传就等于阻断启动：{call}"
    );
}
