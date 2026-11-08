//! [V0.11.26] 云端落点：**路径形态**与**建不了目录时的文案**。
//!
//! ## 为什么单独一个文件
//!
//! 两条判据都属于「一旦错了，用户看到的只有一句没法行动的红字」那一类，而它们各自的
//! 邻居（`md_env` 的展开、`md_cloud` 的编排）都已经贴着行数上限。放在一起也正好让下一次
//! 改落点的人一眼看到「路径必须带数据根、错误必须带路径」这两条。
//!
//! ## 这一轮修的是什么（别删这两条用例）
//!
//! 出厂模板 `%APP_DIR%\md-webdav` 里的 `\` 只在 Windows 上是分隔符。Android 上
//! `data_root()` 是 `/data/user/0/com.timing.app`，展开后整个
//! `com.timing.app\md-webdav` 是**一个**路径分量 → 父目录成了 `/data/user/0`
//! （root 所有、应用不可写）→ `create_dir_all` 回 `EACCES`（os error 13）。
//! 「测试连接」只碰网络，所以那一步永远是绿的，用户看到的是「连得上、存不进去」。
//!
//! ## 变异自证
//!
//! 把 `md_env::normalize_separators` 的 `if mobile` 改成 `if false`，
//! `cloud_root_on_posix_is_a_child_of_the_data_root`（`infra/md_env` 内的用例）
//! 与下面第一条同时红；把 `root_dir_error` 的 `root.display()` 删掉，
//! `error_text_carries_the_path` 红。

use std::path::Path;

use crate::models::md_sync::MdSyncKind;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud, MD_SYNC_CLOUD_ROOT};
use crate::services::md_cloud;

/// 建不了目录时必须说出**哪个**目录：落点有两个可能（出厂 / 用户填的），
/// 少一个路径就只能靠猜——这正是这一轮多绕一次的原因。
#[test]
fn error_text_carries_the_path() {
    let root = Path::new("/data/user/0/com.timing.app/md-webdav");
    let err = std::io::Error::from_raw_os_error(13);
    let text = md_cloud::root_dir_error(root, &err);
    assert!(text.contains(root.to_string_lossy().as_ref()), "{text}");
    assert!(text.contains("13"), "原始错误要原样带出去：{text}");
}

/// 出厂模板必须仍是占位符形态：写成绝对路径会在换机器 / 换数据根时指向旧位置。
#[test]
fn cloud_root_template_keeps_the_token() {
    assert!(
        MD_SYNC_CLOUD_ROOT.contains(crate::platform::app_dir::TOKEN),
        "出厂落点必须用 %APP_DIR% 占位：{MD_SYNC_CLOUD_ROOT}"
    );
}

/// Webdav 模式的生效落点 = 数据根下的 `md-webdav`，且与 Obsidian 落点 `md` 不重叠
/// （两份基线互不污染，ADR-061 §风险 2）。
#[test]
fn webdav_root_sits_beside_the_obsidian_root() {
    let cloud = MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        local_root: String::new(),
        base_url: "https://dav.jianguoyun.com/dav/".into(),
        base_path: "/Timing".into(),
        user: "someone@example.com".into(),
        auto: None,
    };
    let root = cloud.resolve_root().expect("Webdav 模式有出厂落点");
    assert!(root.is_absolute(), "{}", root.display());
    assert_eq!(root.file_name().and_then(|n| n.to_str()), Some("md-webdav"));
    assert_eq!(root.parent(), Some(crate::platform::app_dir::data_root().as_path()));
}

/// `LocalFolder` 模式的落点就是用户填的那个目录（展开后），**不**加 `md-webdav` 后缀。
#[test]
fn folder_root_is_the_user_directory() {
    let cloud = MdSyncCloud {
        enabled: true,
        mode: CloudMode::LocalFolder,
        local_root: format!("{}\\我的日记", crate::platform::app_dir::TOKEN),
        base_url: String::new(),
        base_path: String::new(),
        user: String::new(),
        auto: None,
    };
    let root = cloud.resolve_root().expect("填了目录就能解析");
    assert!(root.ends_with("我的日记"), "{}", root.display());
}

/// 空目录不是「落到当前目录」：必须报错（否则会往 CWD 里写一棵树）。
#[test]
fn empty_folder_root_is_refused() {
    let cloud = MdSyncCloud {
        enabled: true,
        mode: CloudMode::LocalFolder,
        local_root: "   ".into(),
        base_url: String::new(),
        base_path: String::new(),
        user: String::new(),
        auto: None,
    };
    assert!(cloud.resolve_root().is_err());
}

/// 三种落点（计时 / 便利贴 / 待办）都落到同一个文件时，文件名模板仍然只有一个来源。
/// 这里只钉「云端轮会把根换成落点根」这条前提：`mirror::run_in` 传的就是它。
#[test]
fn cloud_root_is_a_single_directory_for_all_kinds() {
    let root = crate::infra::md_env::resolve_template(
        MD_SYNC_CLOUD_ROOT,
        "/data/user/0/com.timing.app",
        true,
    );
    for kind in [MdSyncKind::Timers, MdSyncKind::Notes, MdSyncKind::Todos] {
        assert!(kind.label().len() > 1, "三种落点都要有名字：{kind:?}");
    }
    assert!(root.ends_with("/md-webdav"), "{root}");
}
