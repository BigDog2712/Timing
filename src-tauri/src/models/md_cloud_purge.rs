//! 云端往期真删的记账模型（V0.11.19 变更 A，设计 §3.5 / §8.2）。
//!
//! ## 六个 KV 键的唯一出处
//!
//! `channel_key` 是**唯一**允许写出 `md_cloud.purge.…` 字面量的地方。`purge/`、
//! `state.rs`、`resume` 三个读者都调它，不写第二份字符串：换通道后水位已过、
//! 那年文件永远不清（共用 `upto`），或者 WebDAV 认证失败把没有认证的本地目录
//! 那条路一起暂停（共用 `state`），都是**永久漏删**，不是延迟。
//!
//! 这些键全部是「同步自身的记账」，不是业务配置：它们不进批 1 脏标记白名单
//! （L8 门禁只允许 `commands/` 打 `dirty::mark`，每天清一次不会触发一轮无意义的
//! 写 md）。也没有第五类键、不加表不加列，迁移版本仍是 `0006`。

use serde::{Deserialize, Serialize};

/// 通路。水位 / 扫过日 / 暂停状态都按它分开。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PurgeChannel {
    Webdav,
    Folder,
}

impl PurgeChannel {
    /// 通路标识的**唯一**字符串出处（[V0.11.26]）。
    ///
    /// `md_cloud_pending.channel` 列的取值与它同源（设计 §八 3：不许出现第三种拼法）。
    /// 要新增取值（比如第三条通路）时，这里改一行、调用方全部跟走。
    pub fn as_str(self) -> &'static str {
        match self {
            PurgeChannel::Webdav => "webdav",
            PurgeChannel::Folder => "folder",
        }
    }
}

/// 键的种类。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PurgeKey {
    Upto,
    Day,
    State,
}

/// 六个键名的唯一出口。值域逐字见设计 §3.5 的表。
pub fn channel_key(ch: PurgeChannel, kind: PurgeKey) -> &'static str {
    match (kind, ch) {
        (PurgeKey::Upto, PurgeChannel::Webdav) => "md_cloud.purge.upto.webdav",
        (PurgeKey::Upto, PurgeChannel::Folder) => "md_cloud.purge.upto.folder",
        (PurgeKey::Day, PurgeChannel::Webdav) => "md_cloud.purge.day.webdav",
        (PurgeKey::Day, PurgeChannel::Folder) => "md_cloud.purge.day.folder",
        (PurgeKey::State, PurgeChannel::Webdav) => "md_cloud.purge.state.webdav",
        (PurgeKey::State, PurgeChannel::Folder) => "md_cloud.purge.state.folder",
    }
}

/// 闸③ 整段拒绝时块④ 的逐字红字（PRD §2.9.1 给定，不许改写）。
pub const OVERLAP_TEXT: &str =
    "云端目录和日记目录重合了，为安全起见不会清理往期文件。请把「云端目录」换成另一个文件夹。";

/// 一个通道的连续失败 / 暂停 / 上一轮份数。存在 `state.{ch}` 这个 KV 里。
///
/// `#[serde(default)]` 保证老值（没有 `overlapNote`）也能反序列化；新增字段不另起键。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PurgeState {
    /// 连续失败的自然日数。
    pub fail_days: u32,
    /// 最近一次失败的自然日（`yyyy-MM-dd`）。
    pub last_fail_day: String,
    /// 连续 3 天失败后暂停，等用户点一次「立即同步」。
    pub paused: bool,
    /// 上一轮删掉的份数（块④ 只读文字的 `{n}`）。
    pub last_deleted: u32,
    /// 上一轮失败的份数。
    pub last_failed: u32,
    /// 闸③ 拒绝时留下的逐字红字；空串 = 没有。空串而不是 `Option` 是为了
    /// 让「清掉」和「没写过」在 JSON 里同形，`resume` 只需置空。
    pub overlap_note: String,
}

/// 块④ 状态区那一行的读侧投影。**只反映当前生效通道**。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdCloudPurgeStatus {
    pub paused: bool,
    pub deleted: u32,
    pub failed: u32,
    /// 不进线缆：仅 `state.rs` 用来把闸③ 红字放进 `MdSyncCloudStatus.last_error`。
    #[serde(skip)]
    pub overlap_note: Option<String>,
}

impl PurgeState {
    /// 投影成界面要的三个份数；`overlap_note` 非空时一并带出。
    pub fn view(&self) -> MdCloudPurgeStatus {
        MdCloudPurgeStatus {
            paused: self.paused,
            deleted: self.last_deleted,
            failed: self.last_failed,
            overlap_note: (!self.overlap_note.is_empty()).then(|| self.overlap_note.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn six_keys_are_all_distinct_and_channel_scoped() {
        let mut keys = Vec::new();
        for ch in [PurgeChannel::Webdav, PurgeChannel::Folder] {
            for kind in [PurgeKey::Upto, PurgeKey::Day, PurgeKey::State] {
                keys.push(channel_key(ch, kind));
            }
        }
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), 6, "六个键必须互不相同，否则两条通道会串账");
        assert!(keys.iter().all(|key| key.starts_with("md_cloud.purge.")));
    }

    #[test]
    fn old_state_json_without_overlap_note_still_parses() {
        let old = r#"{"failDays":2,"lastFailDay":"2026-11-04","paused":true,"lastDeleted":3,"lastFailed":1}"#;
        let state: PurgeState = serde_json::from_str(old).expect("老值要能读");
        assert_eq!(state.fail_days, 2);
        assert!(state.paused);
        assert_eq!(state.overlap_note, "", "缺字段按空串补，不能凭空冒出红字");
    }

    #[test]
    fn view_carries_the_verbatim_overlap_note_only_when_present() {
        let mut state = PurgeState::default();
        assert_eq!(state.view().overlap_note, None);
        state.overlap_note = OVERLAP_TEXT.to_string();
        assert_eq!(state.view().overlap_note.as_deref(), Some(OVERLAP_TEXT));
    }
}
