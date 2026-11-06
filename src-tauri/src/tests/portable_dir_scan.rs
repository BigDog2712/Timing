//! 插件扫描根的**去重与形态**（V0.11.6 / ADR-050 §1）。
//!
//! 从 `portable_dir.rs` 拆出来（单文件 ≤300 行，ADR-017）：那边是「搬运 / 探测」口径，
//! 这里是「三处合并扫描时根目录列表长什么样」——两者改动的理由不同，放一起会越界。
//!
//! 共同前提：`scan_roots_for(app_data_dir, portable)` 是**纯函数**，只拼路径、不碰磁盘，
//! 所以用例可以直接把任意目录当 `app_data_dir` 注入。

use std::path::{Path, PathBuf};

use crate::infra::plugin_fs;
use crate::models::plugin::PluginSource;

fn temp(tag: &str) -> PathBuf {
    crate::tests::support::unique_dir(tag)
}

/// 把「exe 所在目录」当 app_data_dir 传进去，`user` 根（`<exe>\plugins`）就会
/// 与 `exe` 根撞上（`user_plugin_dir` 只是再 join 一层 "plugins"）。去重没生效时
/// 这里会多出一条，进而让同一个插件 id 在设置页冒充两条并记一次「被跳过」。
#[test]
fn scan_roots_never_lists_the_same_directory_twice() {
    let exe_dir = current_exe_dir();
    let roots = plugin_fs::scan_roots_for(&exe_dir, false);
    assert_no_duplicates(&roots);
}

/// 便携模式：只产出 `user`（路径仍是 `<exe>\plugins`），**不产出 `exe`**。
///
/// 依据：便携版没有「随包插件」这个实体（`<exe>\plugins` 就是用户目录），再标一条
/// `exe` 会让用户自己放进去的插件在设置页自称「随包」（ADR-050 §1）。
#[test]
fn scan_roots_in_portable_mode_lists_the_exe_dir_as_user_only() {
    let exe_dir = current_exe_dir();
    let roots = plugin_fs::scan_roots_for(&exe_dir, true);

    assert_no_duplicates(&roots);
    assert!(
        roots.iter().all(|(source, _)| *source != PluginSource::Exe),
        "便携模式不该产出 `exe` 根：{roots:?}"
    );
    let users: Vec<&PathBuf> = roots
        .iter()
        .filter(|(source, _)| *source == PluginSource::User)
        .map(|(_, dir)| dir)
        .collect();
    assert_eq!(users.len(), 1, "用户根有且只有一条：{roots:?}");
    assert_eq!(
        users[0],
        &exe_dir.join("plugins"),
        "便携模式的用户根就是 exe 旁边的 plugins"
    );
}

/// 回退 AppData：`exe` 与 `user` 是**两个不同目录**，两条都在（行为与改前一致）。
///
/// 这条专测「用户点了『改用 AppData』之后」才会走到的路径——最容易没人测的分支。
#[test]
fn scan_roots_in_fallback_mode_keeps_exe_and_user_apart() {
    let exe_dir = current_exe_dir();
    /* 回退时 app_data_dir 是 `%APPDATA%\com.timing.app`，与 exe 目录不同父。 */
    let appdata = temp("portable-fallback-appdata");
    std::fs::create_dir_all(&appdata).expect("建 appdata 夹具");

    let roots = plugin_fs::scan_roots_for(&appdata, false);
    assert_no_duplicates(&roots);
    let of = |want: PluginSource| -> Vec<PathBuf> {
        roots
            .iter()
            .filter(|(source, _)| *source == want)
            .map(|(_, dir)| dir.clone())
            .collect()
    };
    let exe = of(PluginSource::Exe);
    let user = of(PluginSource::User);
    assert_eq!(exe.len(), 1, "回退模式必须保留 exe 根：{roots:?}");
    assert_eq!(user.len(), 1, "回退模式必须保留 user 根：{roots:?}");
    assert_eq!(exe[0], exe_dir.join("plugins"));
    assert_eq!(user[0], appdata.join("plugins"));
    assert_ne!(exe[0], user[0], "回退模式下两者是两个不同目录");
    std::fs::remove_dir_all(&appdata).ok();
}

fn current_exe_dir() -> PathBuf {
    std::env::current_exe()
        .expect("取当前测试二进制路径")
        .parent()
        .expect("有父目录")
        .to_path_buf()
}

#[track_caller]
fn assert_no_duplicates(roots: &[(PluginSource, PathBuf)]) {
    let mut keys: Vec<String> = roots.iter().map(|(_, dir)| to_key(dir)).collect();
    let total = keys.len();
    keys.sort();
    keys.dedup();
    assert_eq!(total, keys.len(), "根目录列表里不许有重复路径：{roots:?}");
}

/// Windows 路径大小写不敏感，比较去重时必须先归一。
fn to_key(dir: &Path) -> String {
    dir.to_string_lossy().to_ascii_lowercase()
}
