//! `models::md_sync_channel` 的单元测试（拆出以守住单文件 ≤300 行）。
//!
//! 钉住四件事：`split_legacy` 的两条对称路径 / `null` 折出两个 `None`、webdav 通路的
//! 落点恒为出厂默认根（不吃 `localRoot`）、远端目录的规范化与 `..` 拒绝、
//! folder 通路的「目录不能与落点重合」。

use super::*;
use super::*;
use crate::models::md_sync::MdSyncKind;

fn binding(root: &str) -> MdSyncBinding {
    MdSyncBinding {
        kind: MdSyncKind::Timers,
        enabled: true,
        root: root.into(),
        file: "{date}.md".into(),
        heading: "#### 事项计时".into(),
    }
}

fn legacy(mode: CloudMode) -> MdSyncCloud {
    MdSyncCloud {
        enabled: true,
        mode,
        local_root: r"D:\Nutstore".into(),
        base_url: "https://dav.jianguoyun.com/dav/".into(),
        base_path: "/Timing".into(),
        user: "me@example.com".into(),
        auto: None,
    }
}

#[test]
fn split_legacy_localfolder_hands_everything_to_folder() {
    let (folder, webdav) = split_legacy(Some(&legacy(CloudMode::LocalFolder)));
    let folder = folder.expect("活跃侧必须物化出来");
    assert!(folder.enabled && folder.is_usable_folder());
    assert_eq!(folder.local_root, r"D:\Nutstore");
    let webdav = webdav.expect("非活跃侧也物化（字段留原值）");
    assert!(!webdav.enabled && !webdav.is_usable_webdav());
    assert_eq!(webdav.base_url, "https://dav.jianguoyun.com/dav/", "三件套留原值");
    assert_eq!(webdav.auto, None, "非活跃通路 auto 承接为 None");
}

#[test]
fn split_legacy_webdav_is_symmetric() {
    let (folder, webdav) = split_legacy(Some(&legacy(CloudMode::Webdav)));
    assert!(!folder.as_ref().is_some_and(|c| c.enabled));
    assert_eq!(folder.as_ref().map(|c| c.local_root.as_str()), Some(r"D:\Nutstore"));
    let webdav = webdav.expect("活跃侧必须物化出来");
    assert!(webdav.is_usable_webdav());
}

#[test]
fn split_legacy_none_is_none() {
    assert_eq!(split_legacy(None), (None, None));
}

#[test]
fn webdav_channel_root_is_the_factory_default() {
    let channel = MdSyncCloudChannel::default();
    assert_eq!(
        channel.resolve_root_webdav().expect("出厂模板必须能解析"),
        PathBuf::from(crate::infra::md_env::expand_env(MD_SYNC_CLOUD_ROOT)),
        "webdav 通路恒用出厂默认根，不吃 localRoot"
    );
}

#[test]
fn remote_dir_rejects_parent_segments() {
    let channel = MdSyncCloudChannel { base_path: "/a/../b".into(), ..Default::default() };
    assert!(channel.remote_dir().is_err());
    assert_eq!(
        MdSyncCloudChannel { base_path: "/a//b/".into(), ..Default::default() }
            .remote_dir()
            .expect("规范化应成功"),
        "/a/b"
    );
}

#[test]
fn folder_validation_refuses_binding_overlap() {
    let channel = MdSyncCloudChannel { enabled: true, local_root: r"D:\vault".into(), ..Default::default() };
    assert!(channel.validate_folder(&[binding(r"D:\VAULT")]).is_err());
    assert!(channel.validate_folder(&[binding(r"D:\other")]).is_ok());
}
