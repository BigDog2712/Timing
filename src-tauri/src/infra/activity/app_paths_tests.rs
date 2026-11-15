//! `app_paths` 的判据（拆出本文件只为 300 行门禁，见那个模块里 `#[path]` 那行的说明）。
//!
//! 这一组大多是**冻结坐标**：值就是判据本体，所以断言里写的是字面量。

use super::*;
use crate::infra::activity::storage_paths::SQLITE_DB_FILE_NAME;

#[test]
fn resolves_profile_from_current_identifiers() {
    assert_eq!(
        AppProfile::from_identifier("com.ceceliaee.patina"),
        AppProfile::Production
    );
    assert_eq!(
        AppProfile::from_identifier("com.ceceliaee.patina.local"),
        AppProfile::Local
    );
    assert_eq!(
        AppProfile::from_identifier("com.ceceliaee.patina.dev"),
        AppProfile::Dev
    );
}

#[test]
fn profile_folder_names_are_user_visible() {
    assert_eq!(AppProfile::Production.product_folder(), "Patina");
    assert_eq!(AppProfile::Local.product_folder(), "Patina Local");
    assert_eq!(AppProfile::Dev.product_folder(), "Patina Dev");
}

#[test]
fn debug_production_build_uses_dev_webview_folder() {
    #[cfg(debug_assertions)]
    assert_eq!(
        AppProfile::Production.webview_product_folder(),
        "Patina Dev"
    );

    #[cfg(not(debug_assertions))]
    assert_eq!(AppProfile::Production.webview_product_folder(), "Patina");
}

#[test]
fn debug_build_requires_an_isolated_persistent_profile() {
    assert!(!persistent_profile_is_allowed(
        AppProfile::Production,
        true,
        false,
    ));
    assert!(persistent_profile_is_allowed(
        AppProfile::Production,
        true,
        true,
    ));
    assert!(persistent_profile_is_allowed(AppProfile::Dev, true, false,));
    assert!(persistent_profile_is_allowed(
        AppProfile::Local,
        true,
        false,
    ));
}

#[test]
fn release_build_can_use_the_production_profile() {
    assert!(persistent_profile_is_allowed(
        AppProfile::Production,
        false,
        false,
    ));
}

#[test]
fn profile_folder_names_do_not_use_internal_identifiers() {
    for profile in [AppProfile::Production, AppProfile::Local, AppProfile::Dev] {
        let folder = profile.product_folder();
        assert!(!folder.contains("com.ceceliaee.patina"));
        assert!(!folder.contains("io.github"));
    }
}

#[test]
fn profile_keys_are_stable_anchor_identifiers() {
    assert_eq!(AppProfile::Production.key(), "production");
    assert_eq!(AppProfile::Local.key(), "local");
    assert_eq!(AppProfile::Dev.key(), "dev");
}

#[test]
fn product_and_identifier_coordinates_are_frozen() {
    /* 这 6 个值是**外部坐标**：安装目录 / 注册表键 / 凭证键 / WebView 缓存目录全由
    它们派生。改动不是「文案变了」，而是老用户的数据与凭证整体失联 —— 且多数路径
    是静默的（`webview_cache` 直接按目录名定位、凭证 target 由 identifier 拼出来）。
    字面量就是判据本体：不许推导（`PRODUCT_FOLDER` 与 `PRODUCT_FOLDER_LOCAL` 若按
    前缀拼出来，两个值一起漂也不会报）。 */
    assert_eq!(PRODUCT_FOLDER, "Patina");
    assert_eq!(PRODUCT_FOLDER_LOCAL, "Patina Local");
    assert_eq!(PRODUCT_FOLDER_DEV, "Patina Dev");
    assert_eq!(IDENTIFIER_PROD, "com.ceceliaee.patina");
    assert_eq!(IDENTIFIER_LOCAL, "com.ceceliaee.patina.local");
    assert_eq!(IDENTIFIER_DEV, "com.ceceliaee.patina.dev");
}

#[test]
fn upstream_coordinates_are_frozen() {
    // 上游源库是**别人的**安装位置（独立安装的 Patina），永久冻结。
    assert_eq!(UPSTREAM_PRODUCT_FOLDER, "Patina");
    assert_eq!(UPSTREAM_DB_FILE, "patina.db");
    /* T05 把 `SQLITE_DB_FILE_NAME` 翻成 `activity.db` 之后这条才可能为真（之前两个常量
    合法地同值）。它防的是「为整洁把上下游两个常量合并成一个」——合并之后首启导入会去
    `%APPDATA%\activity.db` 找别人的历史，导入静默失效且标记照写。 */
    assert_ne!(UPSTREAM_DB_FILE, SQLITE_DB_FILE_NAME);
}
