//! 导出中转文件名的**归属判定**（去 Patina 化 T04-5，从 `scheduled_export.rs` 抽出）。
//!
//! 定时导出会在**用户的导出目录**里先写一个 `.…part` 中转文件，写完才改成正式名；中途失败
//! 要把它删掉。删之前必须先认名字 —— 认不出就当别人的文件，宁可不删也不能误删用户的东西。
//!
//! 旧前缀 `.patina-…` 一并认。理由不是怀旧：升级后第一次清理要能扫掉上个版本留下的中转
//! 文件，否则那些 `.part` 会永远躺在用户导出目录里。**改名不是"忘掉旧文件"的许可证。**
//! 认旧前缀也不放宽安全边界 —— 旧前缀同样是我们自己起的名字，不是通配。

const CURRENT_PREFIX: &str = ".activity-scheduled-export-";
const LEGACY_PREFIX: &str = ".patina-scheduled-export-";

/// 这个名字是不是我们自己写的中转文件。
pub(crate) fn is_owned(name: &str) -> bool {
    name.starts_with(CURRENT_PREFIX) || name.starts_with(LEGACY_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_current_and_legacy_staging_names() {
        assert!(is_owned(".activity-scheduled-export-abc123.csv.part"));
        assert!(is_owned(".patina-scheduled-export-abc123.csv.part"));
    }

    #[test]
    fn refuses_anything_we_did_not_name() {
        /* 少了尾随连字符、只差一个字母、纯用户文件名 —— 一律不认。 */
        for name in [
            "report.csv",
            "activity-export.csv",
            ".activity-scheduled-export",
            ".activity-scheduled-exported-x.part",
            ".USER-REPORT-1.csv.part",
        ] {
            assert!(!is_owned(name), "不该认领 {name}");
        }
    }
}
