//! 云端自动同步三档（`MdSyncCloud.auto`，V0.11.19 批 1，设计 §4.7 / §8.2）。
//!
//! 单独成文件而不是塞进 `md_sync_cloud.rs`：那个文件贴着 300 行门禁（§9 真临界），
//! 而「档位 + 分钟数」是**两个独立字段**，自带默认值与夹值逻辑，需要一个自己的家。
//!
//! ## 为什么 `interval_minutes` 与 `schedule` 必须分开
//!
//! 合成一个字段（例如「`N=0` 表示关闭」）会让「定时 30 → 智能 → 定时」把 30 变回 15：
//! 切到智能时那个数没有地方存。PRD §15.2.1 H-2 把这条钉成硬要求，切档回调因此
//! **只改 `schedule`**，`interval_minutes` 原样带过。
//!
//! ## 为什么 `Option<MdCloudAuto>` 而不是直接给 `MdSyncCloud` 加默认值
//!
//! 老配置里没有 `auto` 这个键。若落库时序列化成 `"auto":{...}` 或 `"auto":null`，
//! `tests/qa_live_config_roundtrip.rs` 的整串比对会红 —— 那不是测试变严，是用户的
//! `settings` 行被一次「什么都没改的保存」改写了。所以字段带
//! `skip_serializing_if = "Option::is_none"`，`None` 一律按「智能 + 15 分钟」解释，
//! 只有用户真的动过档位才写回。

use serde::{Deserialize, Serialize};

use crate::models::constants::{
    MD_CLOUD_INTERVAL_DEFAULT_MINUTES, MD_CLOUD_INTERVAL_MAX_MINUTES,
    MD_CLOUD_INTERVAL_MIN_MINUTES,
};

/// 三档。线缆值由 `rename_all = "lowercase"` 决定：`off` / `interval` / `smart`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudSchedule {
    /// 自动路径彻底不跑，只剩「立即同步 / 托盘 / 保存并同步」三个手动入口。
    Off,
    /// 每 N 分钟一轮，与有无改动无关。
    Interval,
    /// 停手 5 分钟 / 启动后一次 / 30 分钟上限兜底。
    #[default]
    Smart,
}

impl CloudSchedule {
    /// 日志里的档位名（§11.3 `md cloud tier: schedule=...`）。用户可见中文另在前端。
    pub fn label(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Interval => "interval",
            Self::Smart => "smart",
        }
    }
}

/// 云端那一摊自己的节奏配置；与 `baseUrl` / `mode` 同属 `cloud` 这一份配置。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MdCloudAuto {
    #[serde(default)]
    pub schedule: CloudSchedule,
    #[serde(default = "default_interval_minutes")]
    pub interval_minutes: u32,
}

fn default_interval_minutes() -> u32 {
    MD_CLOUD_INTERVAL_DEFAULT_MINUTES
}

impl Default for MdCloudAuto {
    fn default() -> Self {
        Self {
            schedule: CloudSchedule::Smart,
            interval_minutes: MD_CLOUD_INTERVAL_DEFAULT_MINUTES,
        }
    }
}

impl MdCloudAuto {
    /// 老配置 / 越界值统一收敛到 `[5, 120]`。用户填 `1` → 5，`999` → 120（PRD D2）。
    pub fn clamped_minutes(&self) -> u32 {
        self.interval_minutes
            .clamp(MD_CLOUD_INTERVAL_MIN_MINUTES, MD_CLOUD_INTERVAL_MAX_MINUTES)
    }

    /// 定时档的周期（秒）。`secs()` 用的是夹过的分钟数，不让库里的脏值变成 0 秒风暴。
    pub fn interval_secs(&self) -> u64 {
        u64::from(self.clamped_minutes()) * 60
    }
}

#[cfg(test)]
mod tests {
    use super::{CloudSchedule, MdCloudAuto};
    use crate::models::constants::{
        MD_CLOUD_INTERVAL_DEFAULT_MINUTES, MD_CLOUD_INTERVAL_MAX_MINUTES,
        MD_CLOUD_INTERVAL_MIN_MINUTES,
    };

    #[test]
    fn default_is_smart_and_fifteen_minutes() {
        let auto = MdCloudAuto::default();
        assert_eq!(auto.schedule, CloudSchedule::Smart);
        assert_eq!(auto.interval_minutes, MD_CLOUD_INTERVAL_DEFAULT_MINUTES);
    }

    #[test]
    fn out_of_range_minutes_are_clamped_not_rejected() {
        assert_eq!(MdCloudAuto { interval_minutes: 1, ..Default::default() }.clamped_minutes(), MD_CLOUD_INTERVAL_MIN_MINUTES);
        assert_eq!(MdCloudAuto { interval_minutes: 999, ..Default::default() }.clamped_minutes(), MD_CLOUD_INTERVAL_MAX_MINUTES);
    }

    #[test]
    fn old_json_without_auto_deserializes_to_the_default() {
        let parsed: MdCloudAuto = serde_json::from_str("{}").expect("老配置必须能解析");
        assert_eq!(parsed, MdCloudAuto::default());
        let partial: MdCloudAuto = serde_json::from_str(r#"{"schedule":"interval"}"#).expect("缺字段要补默认");
        assert_eq!(partial.interval_minutes, MD_CLOUD_INTERVAL_DEFAULT_MINUTES);
    }

    #[test]
    fn switching_schedule_keeps_the_minutes_field() {
        let auto = MdCloudAuto { schedule: CloudSchedule::Interval, interval_minutes: 30 };
        let switched = MdCloudAuto { schedule: CloudSchedule::Smart, ..auto.clone() };
        assert_eq!(switched.interval_minutes, 30, "切档不许把用户填过的分钟数盖回 15");
        assert_eq!(switched.interval_secs(), 30 * 60);
    }
}
