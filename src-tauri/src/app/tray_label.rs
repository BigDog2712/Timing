//! 托盘「Markdown 同步」菜单项的**标签与拦截判据**（V0.11.26 设置页改造，设计 §1.1 / §八 7）。
//!
//! 从 `tray_sync.rs`（294 行、贴门禁）迁出：三态判定 + `blocked_notice` 集中一处，
//! 那边只剩「点完之后做的事」。完成 / 失败通知标题从硬编码改为跟随标签（O20：
//! 通知标题 ≡ 菜单项文字）。
//!
//! ## 三态（O20）
//!
//! 判定顺序 = md 总开关优先 → webdav 通路 → folder 通路 → 兜底：
//! - 总开关关着 / 两条通路都不可用 → `Markdown 同步`（这一轮只写 Obsidian 那份）；
//! - webdav 可用 → `云端同步`；
//! - 仅 folder 可用 → `本地同步`。
//!
//! 标签必须诚实描述「这一下会同步到哪里」（§14.2.1 既有纪律）。读配置失败按兜底处理
//! ——标签只是提示，为它崩掉托盘不划算，真失败由通知 / 块④⑤ 状态行说。

use sqlx::SqlitePool;

use crate::models::md_sync::MdSyncConfig;
use crate::services;

/// 两条通路都不可用（或总开关关着）时的菜单项文字（与 `tray.rs` 首次装配用的常量一致）。
pub(crate) const LOCAL_LABEL: &str = "Markdown 同步";
/// webdav 通路生效时的菜单项文字。
pub(crate) const CLOUD_LABEL: &str = "云端同步";
/// 仅 folder 通路生效时的菜单项文字（[V0.11.26] 新增第三态，PRD L7）。
pub(crate) const FOLDER_LABEL: &str = "本地同步";

/// 托盘「Markdown 同步」这一项的**标签**：读生效通路，不读草稿里的选择。
///
/// 判据 = `config.enabled` **且** `md_cloud::usable_webdav / usable_folder`
/// （唯一出口，不许在这里重判字段）。两条缺一不可，各挡一句假话：
/// - 只看通路 `enabled`：字段没填全时那一轮仍走 `md_sync::run`，说「云端同步」是骗人；
/// - 只看 `usable_*`：它**不含顶层总开关**（还服务 `round` / 调度链 / 手机端），
///   总开关关着而通路填全时写着「云端同步」，点下去弹的却是「先在设置里打开 Markdown 同步」。
pub(crate) async fn sync_label(pool: &SqlitePool) -> &'static str {
    match services::md_sync::config::load(pool).await {
        Ok(config) => {
            /* 总开关关着 → 这一轮连 `md_sync::run` 都不会进，说「云端同步」是假话。 */
            if !config.enabled {
                return LOCAL_LABEL;
            }
            if services::md_cloud::usable_webdav(&config).is_some() {
                CLOUD_LABEL
            } else if services::md_cloud::usable_folder(&config).is_some() {
                FOLDER_LABEL
            } else {
                LOCAL_LABEL
            }
        }
        Err(err) => {
            crate::log_warn!("tray sync label: load config failed: {err}");
            LOCAL_LABEL
        }
    }
}

/// 点同步时「压根不会跑到用户以为的那条通路」的判据（**纯函数**，便于单测）：
/// `Some((通知标题, 通知正文))`；`None` = 这一下会真的跑。
///
/// **标题规范：必须与用户刚刚点的那一项标签逐字相同**——通知是对「你刚做的动作」的回应。
/// blocked 标题恒 `LOCAL_LABEL`（这两档下 `sync_label` 都返回它），两档靠**正文**区分，
/// 都指向设置页同一个地方。
///
/// [V0.11.26] 「没填全」按通路各判各的，但**只要有一条通路能跑就不拦**：
/// 点了这一下确实会同步到那条通路，插话反而挡住了真事（块④/⑤ 的状态行会各自报告
/// 自己那条的缺项）。只有「有通路开着、却一条都跑不起来」才是这一下什么都不同步的档。
///
/// 判据因此必须与 `sync_label` 同源：拦下 ⇔ 菜单项写着 `Markdown 同步`（O20）。
pub(crate) fn blocked_notice(
    config: &MdSyncConfig,
) -> Option<(&'static str, &'static str)> {
    if !config.enabled {
        return Some((LOCAL_LABEL, "先在设置里打开 Markdown 同步"));
    }
    let folder_on = config
        .cloud_folder
        .as_ref()
        .is_some_and(|channel| channel.enabled);
    let webdav_on = config
        .cloud_webdav
        .as_ref()
        .is_some_and(|channel| channel.enabled);
    let any_ready = services::md_cloud::usable_folder(config).is_some()
        || services::md_cloud::usable_webdav(config).is_some();
    if (folder_on || webdav_on) && !any_ready {
        return Some((LOCAL_LABEL, "先在设置里填好云端"));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_three_distinct_strings() {
        assert_ne!(LOCAL_LABEL, CLOUD_LABEL);
        assert_ne!(CLOUD_LABEL, FOLDER_LABEL);
        assert_ne!(LOCAL_LABEL, FOLDER_LABEL, "三态必须能区分，否则菜单项会骗人");
    }

    #[test]
    fn blocked_notice_when_a_channel_is_on_but_not_filled() {
        let mut config = MdSyncConfig {
            enabled: true,
            ..Default::default()
        };
        assert_eq!(blocked_notice(&config), None, "两条都关着 = 只写 Obsidian 那份，放行");
        config.cloud_webdav = Some(crate::models::md_sync_channel::MdSyncCloudChannel {
            enabled: true,
            ..Default::default()
        });
        assert_eq!(
            blocked_notice(&config),
            Some((LOCAL_LABEL, "先在设置里填好云端")),
            "开着却没填全必须拦下来说明"
        );
        /* 反向：另一条通路填全了就不拦——这一下确实会同步到那一半（块④/⑤ 各报自己的缺项）。 */
        config.cloud_folder = Some(crate::models::md_sync_channel::MdSyncCloudChannel {
            enabled: true,
            local_root: r"D:\vault".into(),
            ..Default::default()
        });
        assert_eq!(blocked_notice(&config), None, "有一条能跑就不该挡");
    }

    #[test]
    fn blocked_notice_when_master_switch_is_off() {
        let config = MdSyncConfig::default();
        assert_eq!(
            blocked_notice(&config),
            Some((LOCAL_LABEL, "先在设置里打开 Markdown 同步"))
        );
    }
}
