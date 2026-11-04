//! 仓库内 `plugins/md-sync` 的扫描回归：dev 来源必须真正进 `plugin_list`。

use crate::services::plugin;
use crate::tests::support::unique_dir;

#[test]
fn dev_plugin_md_sync_is_scanned_with_contribution() {
    let app_data = unique_dir("dev-plugin-scan");
    std::fs::create_dir_all(&app_data).unwrap();

    let result = plugin::list(&app_data);
    let found = result
        .plugins
        .iter()
        .find(|item| item.id == "md-sync")
        .expect("仓库 plugins/md-sync 应被 dev 扫描根读到");
    assert_eq!(found.source, "dev");
    assert!(found.enabled);
    assert!(found.error.is_none(), "{:?}", found.error);
    let md_sync = found.md_sync.as_ref().expect("应声明 mdSync");
    assert_eq!(md_sync.bindings.len(), 3);

    std::fs::remove_dir_all(&app_data).ok();
}
