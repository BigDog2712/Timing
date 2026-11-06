//! 插件业务（V0.3.2）：出厂预设 + 磁盘扫描 → 合并去重 → 对外快照。
//!
//! 规则不多，但每一条都影响「用户改完文件为什么没生效」，写在这里：
//!
//! 1. **同 id 先到先得**（dev > exe > user）。同一个插件放在两个地方，只认优先级高的，
//!    不合并——合并会让「这份到底加载的是哪个版本」变成玄学。
//! 2. **载入失败不隐藏**：清单解析失败也返回一条带 `error` 的记录，设置页直接显示原因。
//!    静默跳过等于让用户对着一个「明明写了却没反应」的文件夹抓狂。
//! 3. **快捷计时同名覆盖**：后加载的赢（内置预设 < dev < exe < user），位置保持首次出现处。
//!    这样「把摸鱼从 25 分钟改成 40 分钟」只需要再装一个小插件，不用改应用本身。
//! 4. **内置预设不是插件**（V0.3.2 修正）：摸鱼菜单那三条是应用自带功能，没有目录、
//!    不参与启停、不出现在插件列表里；插件只是**按同名覆盖**它。V0.3.4 起设置页也不再
//!    单独展示内置预设（ADR-023）——它只作为下面的合并底座存在。

use std::collections::HashMap;
use std::path::Path;

use crate::infra::plugin_fs;
use crate::models::plugin::{PluginInfo, PluginListResult};
use crate::services::plugin_merge::{merge_quick_timers, source_label, source_rank};

// 出厂预设的实体在 plugin_merge（合并底座），这里只转出去，保持
// `services::plugin::builtin_quick_timers` 这个对外路径不变。
pub use crate::services::plugin_merge::builtin_quick_timers;

/// 扫描 + 合并，返回设置页要展示的全部插件与最终菜单项。
pub fn list(app_data_dir: &Path) -> PluginListResult {
    /* [V0.3.2 修正] 出厂预设不再伪装成一个插件，它只作为合并的底座。 */
    let builtin = builtin_quick_timers();
    let mut plugins: Vec<PluginInfo> = Vec::new();
    /* id → 赢家来源：同 id 后到的**不静默丢弃**，而是列成一条「被跳过」的记录。
    规则 1 只说「先到先得」，但用户看不到这句话时会以为自己的文件没被读到。 */
    let mut seen: HashMap<String, String> = HashMap::new();

    for hit in plugin_fs::scan(app_data_dir) {
        let dir = hit.dir.to_string_lossy().to_string();
        match hit.manifest {
            Ok((manifest, warnings)) => {
                if let Some(winner) = seen.get(&manifest.id) {
                    plugins.push(PluginInfo {
                        id: format!("{}:{}", hit.source.as_str(), manifest.id),
                        name: manifest.name,
                        version: manifest.version,
                        api_version: manifest.api_version,
                        description: manifest.description,
                        source: hit.source.as_str().into(),
                        dir,
                        enabled: false,
                        error: Some(format!(
                            "同一 id 已由「{}」来源加载，本份被跳过（同 id 先到先得：开发 > 随包 > 用户）",
                            source_label(winner)
                        )),
                        quick_timers: Vec::new(),
                        warnings: Vec::new(),
                    });
                    continue;
                }
                seen.insert(manifest.id.clone(), hit.source.as_str().into());
                plugins.push(PluginInfo {
                    id: manifest.id,
                    name: manifest.name,
                    version: manifest.version,
                    api_version: manifest.api_version,
                    description: manifest.description,
                    source: hit.source.as_str().into(),
                    dir,
                    enabled: manifest.enabled,
                    error: None,
                    quick_timers: manifest.contributes.quick_timers,
                    warnings,
                });
            }
            Err(error) => {
                /* 目录名当身份：解析都失败了，里面也不会有可用的 id。 */
                let dir_name = hit
                    .dir
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                plugins.push(PluginInfo {
                    id: format!("invalid:{dir_name}"),
                    name: dir_name,
                    version: String::new(),
                    api_version: 0,
                    description: String::new(),
                    source: hit.source.as_str().into(),
                    dir,
                    enabled: false,
                    error: Some(error),
                    quick_timers: Vec::new(),
                    warnings: Vec::new(),
                });
            }
        }
    }

    /* 展示顺序 = 来源优先级 + 名称：dev → exe → user。用户自己装的排在最后，
    符合「我的在哪」的直觉；内置预设不在这个列表里（它不是插件）。 */
    plugins.sort_by(|a, b| {
        source_rank(&a.source)
            .cmp(&source_rank(&b.source))
            .then_with(|| a.name.cmp(&b.name))
    });

    let quick_timers = merge_quick_timers(&plugins, &builtin);
    PluginListResult {
        dir: plugin_fs::user_plugin_dir(app_data_dir)
            .to_string_lossy()
            .to_string(),
        plugins,
        quick_timers,
    }
}

/// 确保用户插件目录存在（只建空目录，不改动用户已有文件），并返回其路径。
pub fn ensure_user_dir(app_data_dir: &Path) -> Result<String, String> {
    let dir = plugin_fs::user_plugin_dir(app_data_dir);
    plugin_fs::ensure_user_dir(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

/// 在资源管理器里打开用户插件目录（不存在则先建好再开）。
pub fn open_user_dir(app_data_dir: &Path) -> Result<(), String> {
    let dir = plugin_fs::user_plugin_dir(app_data_dir);
    plugin_fs::open_dir(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_has_three_presets() {
        let builtin = builtin_quick_timers();
        assert_eq!(builtin.len(), 3);
        assert_eq!(builtin[1].item, "摸鱼");
        assert_eq!(builtin[1].minutes, 25);
    }

    #[test]
    fn builtin_presets_are_not_a_plugin_row() {
        /* 出厂预设是应用内置功能：plugin_list 里不应出现任何 builtin 来源/内置名的插件。
        [V0.3.4] `builtin` 字段已从返回值删除，因此改为通过菜单断言：
        没有插件时菜单**就是**出厂三条——预设从后门变成了一条独立的插件行。 */
        let root = temp_root("no-builtin-row");
        let result = list(&root);
        assert!(result.plugins.iter().all(|item| item.source != "builtin"));
        assert!(result.plugins.iter().all(|item| item.name != "摸鱼基础包"));
        assert_eq!(result.quick_timers.len(), 3, "没有插件时菜单 = 出厂三条");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn user_plugin_overrides_builtin_preset_by_name() {
        /* 想改「摸鱼 25 分钟」只需装一个同名项插件：不需要动应用本身。 */
        let root = temp_root("override-preset");
        write_plugin(
            &root,
            "longer",
            r#"{"id":"longer-moyu","name":"更长的摸鱼","version":"1.0.0","apiVersion":1,
                "contributes":{"quickTimers":[{"item":"摸鱼","minutes":40}]}}"#,
        );

        let result = list(&root);
        let moyu = result
            .quick_timers
            .iter()
            .find(|quick| quick.item == "摸鱼")
            .expect("摸鱼项");
        assert_eq!(moyu.minutes, 40, "插件同名项覆盖出厂预设");
        /* 出厂预设本身不被改写：直接问底座要，而不是读返回值（返回值已不带 builtin）。 */
        assert_eq!(
            builtin_quick_timers()[1].minutes,
            25,
            "出厂预设本身不被改写"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn shadowed_duplicate_id_is_listed_not_dropped() {
        /* 同一个 id 放两个用户目录：先扫到的赢，后一份不能静默消失，要列出来并说明原因。
        （不用 dev 来源的插件当赢家，免得测试依赖仓库里 plugins/ 目录的内容。） */
        let root = temp_root("shadow");
        write_plugin(
            &root,
            "a-first",
            r#"{"id":"dup-id","name":"先到的包","version":"1.0.0","apiVersion":1,
                "contributes":{"quickTimers":[{"item":"摸鱼","minutes":25}]}}"#,
        );
        write_plugin(
            &root,
            "b-later",
            r#"{"id":"dup-id","name":"用户版摸鱼包","version":"9.9.9","apiVersion":1,
                "contributes":{"quickTimers":[{"item":"摸鱼","minutes":99}]}}"#,
        );

        let result = list(&root);
        /* 目录迭代顺序不保证，所以只断言「恰好一份生效、另一份被列出并说明原因」。 */
        let live: Vec<_> = result
            .plugins
            .iter()
            .filter(|item| item.id == "dup-id" && item.enabled)
            .collect();
        assert_eq!(live.len(), 1, "同 id 只应有一份生效");
        let shadowed = result
            .plugins
            .iter()
            .find(|item| item.id != "dup-id" && item.id.ends_with("dup-id") && !item.enabled)
            .expect("被同 id 挡住的插件也要列出来");
        let reason = shadowed.error.as_deref().unwrap_or_default();
        assert!(reason.contains("同一 id"), "原因要写明被谁挡住：{reason}");
        /* 被挡住的那份不能改动菜单：摸鱼值必须是赢家那份的。 */
        let moyu = result
            .quick_timers
            .iter()
            .find(|quick| quick.item == "摸鱼")
            .expect("摸鱼项");
        let winner_minutes = live[0]
            .quick_timers
            .iter()
            .find(|quick| quick.item == "摸鱼")
            .map(|quick| quick.minutes)
            .expect("赢家带摸鱼项");
        assert_eq!(moyu.minutes, winner_minutes);

        std::fs::remove_dir_all(&root).ok();
    }

    /* ---- 端到端扫盘：验证 read_manifest → scan → list 串起来是通的 ---- */

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "timing-plugin-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_plugin(root: &std::path::Path, folder: &str, json: &str) {
        let dir = root.join("plugins").join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("plugin.json"), json).unwrap();
    }

    #[test]
    fn list_picks_up_user_dir_plugin() {
        let root = temp_root("scan");
        write_plugin(
            &root,
            "sample",
            r#"{"id":"scan-test","name":"扫描测试","version":"0.1.0","apiVersion":1,
                "contributes":{"quickTimers":[{"item":"喝水","minutes":3}]}}"#,
        );

        let result = list(&root);
        let found = result
            .plugins
            .iter()
            .find(|item| item.id == "scan-test")
            .expect("临时目录里的插件应被扫到");
        assert_eq!(found.source, "user");
        assert_eq!(found.quick_timers.len(), 1);
        assert_eq!(found.quick_timers[0].minutes, 3);
        assert!(found.error.is_none());
        assert!(result.quick_timers.iter().any(|quick| quick.item == "喝水"));
        assert!(result.dir.ends_with("plugins"));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn broken_manifest_is_listed_with_reason() {
        let root = temp_root("broken");
        write_plugin(&root, "bad", "{ not json");

        let result = list(&root);
        let broken = result
            .plugins
            .iter()
            .find(|item| item.source == "user")
            .expect("解析失败的目录也要列出来，不能静默消失");
        assert!(!broken.enabled);
        assert!(broken
            .error
            .as_deref()
            .is_some_and(|msg| msg.contains("JSON")));

        std::fs::remove_dir_all(&root).ok();
    }
}
