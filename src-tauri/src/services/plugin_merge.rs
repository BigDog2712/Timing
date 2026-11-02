//! 快捷计时合并（V0.3.2）：把出厂预设 + 各插件贡献的菜单项压成一张去重后的顺序表。
//!
//! 规则只有一条，但很容易写反：**同名事项后写覆盖，位置保持首次出现处**。
//! 「后写」按**来源优先级**算（内置预设 < dev < exe < user），不是按插件显示名——
//! 插件列表为了好看按 `name` 排过序，直接拿那个顺序去合并，覆盖关系就会取决于
//! 插件叫什么（`A 用户包` 排在 `Z 调试包` 前面，于是调试包反压用户包）。
//!
//! 出厂预设（`builtin`）是**应用内置功能**，不是插件：它没有 `PluginInfo`，
//! 只作为合并的底座传进来。
//!
//! 单独成文件是为了守住 300 行的单文件上限（AGENTS.md 硬约束）。

use crate::models::plugin::{PluginInfo, QuickTimer};

/// 出厂预设：摸鱼菜单的默认三行。**这是应用内置功能，不是插件。**
///
/// 它由代码提供，不来自磁盘：用户一个插件都没装、或者把插件目录清空，菜单也还是这三行；
/// 想改时长就装一个同名项的插件覆盖（见 `merge_quick_timers`）。
pub fn builtin_quick_timers() -> Vec<QuickTimer> {
    vec![
        QuickTimer {
            item: "上厕所".into(),
            minutes: 10,
        },
        QuickTimer {
            item: "摸鱼".into(),
            minutes: 25,
        },
        QuickTimer {
            item: "吃饭".into(),
            minutes: 60,
        },
    ]
}

/// 来源优先级（数值大的后写、覆盖前面的）。内置预设不参与比较（它是底座）。
pub(crate) fn source_rank(source: &str) -> u8 {
    match source {
        "dev" => 1,
        "exe" => 2,
        "user" => 3,
        _ => 4,
    }
}

/// 来源的中文名（只用于给用户看的原因说明，不参与排序）。
pub(crate) fn source_label(source: &str) -> &'static str {
    match source {
        "dev" => "开发",
        "exe" => "随包",
        "user" => "用户",
        _ => "未知",
    }
}

/// 同名事项后写覆盖（位置保持首次出现处），停用 / 失败的插件不贡献。
pub fn merge_quick_timers(plugins: &[PluginInfo], builtin: &[QuickTimer]) -> Vec<QuickTimer> {
    let mut ordered: Vec<&PluginInfo> = plugins.iter().collect();
    /* 稳定排序：同一来源内部保持扫描顺序（目录名序），跨来源按 dev < exe < user。 */
    ordered.sort_by_key(|plugin| source_rank(&plugin.source));

    /* 底座 = 出厂预设；插件按同名覆盖它，而不是另起一排。 */
    let mut out: Vec<QuickTimer> = Vec::new();
    for quick in builtin {
        let key = quick.item.trim();
        match out.iter_mut().find(|it| it.item.trim() == key) {
            Some(slot) => *slot = quick.clone(),
            None => out.push(quick.clone()),
        }
    }
    for plugin in ordered {
        for quick in plugin.active_quick_timers() {
            let key = quick.item.trim();
            match out.iter_mut().find(|it| it.item.trim() == key) {
                Some(slot) => *slot = quick.clone(),
                None => out.push(quick.clone()),
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::builtin_quick_timers;
    use super::*;

    fn plugin(name: &str, source: &str, items: &[(&str, u32)]) -> PluginInfo {
        PluginInfo {
            id: format!("plug-{name}"),
            name: name.into(),
            version: "1.0.0".into(),
            api_version: 1,
            description: String::new(),
            source: source.into(),
            dir: String::new(),
            enabled: true,
            error: None,
            quick_timers: items
                .iter()
                .map(|(item, minutes)| QuickTimer {
                    item: (*item).into(),
                    minutes: *minutes,
                })
                .collect(),
            md_sync: None,
        }
    }

    #[test]
    fn later_plugin_overrides_same_item_in_place() {
        let merged = merge_quick_timers(
            &[plugin("b", "user", &[("摸鱼", 40), ("喝水", 5)])],
            &[
                QuickTimer {
                    item: "摸鱼".into(),
                    minutes: 25,
                },
                QuickTimer {
                    item: "吃饭".into(),
                    minutes: 60,
                },
            ],
        );
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].item, "摸鱼");
        assert_eq!(merged[0].minutes, 40, "同名后者覆盖，位置不变");
        assert_eq!(merged[2].item, "喝水");
    }

    #[test]
    fn override_order_follows_source_not_display_name() {
        /* 列表按 name 排序 → `A 用户包` 在 `Z 调试包` 前面；合并仍须 user 压过 dev。 */
        let merged = merge_quick_timers(
            &[
                plugin("A 用户包", "user", &[("摸鱼", 45)]),
                plugin("Z 调试包", "dev", &[("摸鱼", 30)]),
            ],
            &[],
        );
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].minutes, 45, "user 压 dev，与插件显示名无关");
    }

    #[test]
    fn disabled_and_failed_plugins_contribute_nothing() {
        let mut off = plugin("off", "user", &[("摸鱼", 40)]);
        off.enabled = false;
        let mut broken = plugin("broken", "user", &[("吃饭", 5)]);
        broken.error = Some("bad".into());
        let merged = merge_quick_timers(&[off, broken], &builtin_quick_timers());
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[1].minutes, 25);
        assert_eq!(merged[2].minutes, 60);
    }

    #[test]
    fn trims_before_comparing_names() {
        let merged = merge_quick_timers(
            &[plugin("b", "user", &[(" 摸鱼 ", 33)])],
            &[QuickTimer {
                item: "摸鱼".into(),
                minutes: 25,
            }],
        );
        assert_eq!(merged.len(), 1, "带空格的同名项算同一条");
        assert_eq!(merged[0].minutes, 33);
    }

    #[test]
    fn builtin_presets_are_the_base_layer() {
        /* 没有插件时，菜单就是出厂三条——内置预设不依赖任何插件存在。 */
        let merged = merge_quick_timers(&[], &builtin_quick_timers());
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].item, "上厕所");
        assert_eq!(merged[1].minutes, 25);
    }
}
