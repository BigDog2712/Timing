//! 常用摸鱼（应用**内置**预设，不来自插件）DTO。
//!
//! 与 `src/types/domain/models.ts::MoyuPreset` 一一对应（camelCase）。
//! 存储位置：`settings` KV 的 `moyu.presets`（JSON 数组），与 `countdown.presets`
//! 同一口径——顺序即展示顺序，不额外落 sort_order 列，也就不需要迁移。
//!
//! 为什么不走插件：V0.3.9 起用户口径「常用摸鱼是应用内置功能，非插件」。
//! 插件目录里声明的 `quickTimers` 仍由设置页展示，但摸鱼菜单只读这里。

use serde::{Deserialize, Serialize};

use crate::models::constants::{
    MOYU_MAX_MINUTES, MOYU_MIN_MINUTES, MOYU_PRESET_MAX, MOYU_PRESET_NAME_MAX_LEN,
};

/// 摸鱼条目的计时方式：正计时 / 倒计时。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MoyuMode {
    Countup,
    /// 默认倒计时：摸鱼预设的常见语义是「摸 X 分钟」。
    #[default]
    Countdown,
}

/// 摸鱼菜单的一行（应用内置，可增删改 + 排序）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoyuPreset {
    /// 前端生成的稳定标识（`crypto.randomUUID()`）；服务端仅做去重兜底。
    pub id: String,
    /// 事项名（落库前 trim，≤ 40 字符）
    pub item: String,
    /// 目标分钟数；`mode = countup` 时只作占位（前端不展示、不生效）
    pub minutes: i64,
    pub mode: MoyuMode,
}

/// 出厂三条（与 V0.3.2 的内置预设同值，老用户升级后菜单不空）。
pub fn default_presets() -> Vec<MoyuPreset> {
    vec![
        preset("factory-toilet", "上厕所", 10, MoyuMode::Countdown),
        preset("factory-moyu", "摸鱼", 25, MoyuMode::Countdown),
        preset("factory-meal", "吃饭", 60, MoyuMode::Countdown),
    ]
}

/// 归一化：丢空名、名字截断、分钟钳制、id 补齐去重、总条数封顶。
///
/// 刻意**不**在空列表时回落出厂三条——用户把常用摸鱼删光是一个合法状态，
/// 只有「键缺失 / JSON 损坏」才回落到默认值（在 `services::settings` 里区分）。
pub fn normalize_presets(input: Vec<MoyuPreset>) -> Vec<MoyuPreset> {
    let mut out: Vec<MoyuPreset> = Vec::new();
    for raw in input {
        if out.len() >= MOYU_PRESET_MAX {
            break;
        }
        let item = raw.item.trim();
        if item.is_empty() {
            continue;
        }
        let item: String = item.chars().take(MOYU_PRESET_NAME_MAX_LEN).collect();
        let id = unique_id(&out, raw.id.trim());
        out.push(MoyuPreset {
            id,
            item,
            minutes: raw.minutes.clamp(MOYU_MIN_MINUTES, MOYU_MAX_MINUTES),
            mode: raw.mode,
        });
    }
    out
}

fn preset(id: &str, item: &str, minutes: i64, mode: MoyuMode) -> MoyuPreset {
    MoyuPreset {
        id: id.to_string(),
        item: item.to_string(),
        minutes,
        mode,
    }
}

/// 空 id / 重复 id → 生成 `p{n}`；与既有 id 冲突时继续递增。
fn unique_id(existing: &[MoyuPreset], candidate: &str) -> String {
    if !candidate.is_empty() && !existing.iter().any(|p| p.id == candidate) {
        return candidate.to_string();
    }
    let mut n = existing.len() + 1;
    loop {
        let id = format!("p{n}");
        if !existing.iter().any(|p| p.id == id) {
            return id;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(id: &str, item: &str, minutes: i64, mode: MoyuMode) -> MoyuPreset {
        preset(id, item, minutes, mode)
    }

    #[test]
    fn empty_name_is_dropped() {
        let out = normalize_presets(vec![one("a", "   ", 10, MoyuMode::Countdown)]);
        assert!(out.is_empty());
    }

    #[test]
    fn minutes_are_clamped() {
        let out = normalize_presets(vec![
            one("a", "短", 0, MoyuMode::Countdown),
            one("b", "长", 9999, MoyuMode::Countdown),
        ]);
        assert_eq!(out[0].minutes, MOYU_MIN_MINUTES);
        assert_eq!(out[1].minutes, MOYU_MAX_MINUTES);
    }

    #[test]
    fn duplicate_and_empty_ids_get_filled() {
        let out = normalize_presets(vec![
            one("", "甲", 10, MoyuMode::Countdown),
            one("x", "乙", 10, MoyuMode::Countdown),
            one("x", "丙", 10, MoyuMode::Countup),
        ]);
        assert_eq!(out.len(), 3);
        assert!(out.iter().all(|p| !p.id.is_empty()));
        let ids: std::collections::HashSet<_> = out.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn name_is_truncated_by_chars() {
        let long = "字".repeat(MOYU_PRESET_NAME_MAX_LEN + 5);
        let out = normalize_presets(vec![one("a", &long, 10, MoyuMode::Countdown)]);
        assert_eq!(out[0].item.chars().count(), MOYU_PRESET_NAME_MAX_LEN);
    }

    #[test]
    fn empty_input_stays_empty() {
        assert!(normalize_presets(Vec::new()).is_empty());
    }

    #[test]
    fn defaults_match_factory_three() {
        let list = default_presets();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].item, "上厕所");
        assert_eq!(list[0].minutes, 10);
    }
}
