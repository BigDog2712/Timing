//! WebDAV 那一半：**候选集**与**删除动作**（V0.11.19 变更 A，设计 §3.1 / §3.3）。
//!
//! ## 取证 = 本地镜像里有同名文件（不加指纹闸）
//!
//! 候选集就是 `%APP_DIR%\md-webdav\` 里枚举出来的名字：文件当然在，所以「本地有同名
//! 文件」这条证据对本路是恒真的。它仍然写成一条显式判断（`is_file`），是因为**枚举是
//! 唯一入口**：将来若有人把候选集改成「按模板反推 + 远端探测」，这一条就是唯一的闸。
//!
//! **绝不能加指纹闸**（主理人②）：远端那份可能被**另一台设备**改过（PRD §2.8 风险 3
//! 已认「桌面本地有的日期被删，另一台设备的欠账会再推回来」）。拿本地镜像的指纹去卡
//! 远端，一旦某台设备动过，本机就**永久不再清这一天** —— 把「多留几天」变成「永远漏删」。
//! LocalFolder 必须做指纹闸，理由见 `folder.rs`（本地目录是用户能手改的地方）。
//!
//! ## 删除路径只从「读到的文件名」来
//!
//! `rel` 恒等于枚举时读出的那个名字（其内容必然等于 `format!("{date}.md")`，因为
//! 严格日期名解析只认这个形状）。**不从 `binding.file` 模板反推、不拼 `..`、
//! 不递归**：反推会在用户改过模板后删到一个没见过算过的路径上。

use std::fs;
use std::path::Path;

use chrono::NaiveDate;

use super::gate::past_keep_window;
use crate::infra::md_webdav::{remove, WebdavError, WebdavTarget};

/// 候选：`(日期, 枚举读到的文件名)`，按日期升序。
pub(crate) fn candidates(
    root: &Path,
    today: NaiveDate,
    keep: i64,
    upto: Option<NaiveDate>,
) -> Vec<(NaiveDate, String)> {
    let Ok(entries) = fs::read_dir(root) else {
        /* 镜像目录还不存在（从没同步过）= 没有任何「我推过这一天」的证据。 */
        return Vec::new();
    };
    let mut out = Vec::with_capacity(entries.size_hint().0);
    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            /* 非 UTF-8 名字不可能是我们写的 `yyyy-MM-dd.md`。 */
            continue;
        };
        /* 闸①：严格 `^\d{4}-\d{2}-\d{2}\.md$`。全库唯一一份解析在 `gate.rs`。 */
        let Some(date) = super::gate::parse_strict_date_file(&name) else {
            continue;
        };
        /* 闸⑥：路径深度恰为落点根下一层。`read_dir` 天然只有一层，但目录也可能叫
           `2025-01-01.md` —— 显式判成文件，顺手把「不递归」写成代码。
           这一句同时就是闸③（本地镜像里有同名文件）：`entry.path()` 正是
           `root.join(name)`，对 WebDAV 恒真，照写不省（见模块头）。 */
        if !entry.path().is_file() {
            continue;
        }
        /* 闸④：`date < today - keep`。**必须早于比水位**：水位是持久状态，可能被写成
           未来日期，先比水位就会让今天那份进候选 —— 而它是唯一还在被读写的那一份。 */
        if !past_keep_window(date, today, keep) {
            continue;
        }
        /* 闸⑤：`date > upto`（水位）。水位是「这个日期及更早的已确认清理」。 */
        if upto.is_some_and(|upto| date <= upto) {
            continue;
        }
        out.push((date, name));
    }
    out.sort_by_key(|(date, _)| *date);
    out
}

/// 删远端一个文件。语义三档在 `infra::md_webdav::remove`（2xx / 404 / 其余）。
pub(crate) async fn delete_one(target: &WebdavTarget, rel: &str) -> Result<u16, WebdavError> {
    remove::delete_file(target, rel).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("测试日期")
    }

    /// 每个用例一个按名字 + 进程号唯一的目录（并行跑也不撞）。
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("timing-purge-webdav-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    /// I6 / I7 / I8：不匹配严格日期名的、子目录里的、非补零的，一律不进制候选集。
    ///
    /// 这条同时是「日期名解析只有一份」的行为面证据：候选集走的是 `gate.rs` 那个函数，
    /// 形状边界在真实入口上被验，而不是在函数名上直呼。
    #[test]
    fn only_strict_root_level_date_files_become_candidates() {
        let root = temp_dir("strict");
        for name in [
            "2026-11-04.md",
            "2025-01-01-backup.md",
            "timing-write-test.txt",
            "2025-1-5.md",
            "notes.md",
            "2026-13-45.md",
        ] {
            fs::write(root.join(name), "x").expect("写样本");
        }
        /* 子目录里的同名文件：不枚举子目录（I7）。 */
        fs::create_dir_all(root.join("2025")).expect("建子目录");
        fs::write(root.join("2025").join("2025-01-01.md"), "x").expect("写样本");
        /* 一个名字像日期文件的**目录**：不是文件，不进候选。 */
        fs::create_dir_all(root.join("2026-11-03.md")).expect("建同名目录");

        let names: Vec<String> = candidates(&root, day("2026-11-07"), 0, None)
            .into_iter()
            .map(|(_, name)| name)
            .collect();
        assert_eq!(names, vec!["2026-11-04.md".to_string()], "只该有那一个严格日期文件");
        let _ = fs::remove_dir_all(&root);
    }

    /// I9a / I9b：今天与未来永远不进候选，**与水位的值无关**。
    ///
    /// I9b 的手工造法是把水位改成 `2099-01-01`；水位落在未来时今天那份**仍然**不删，
    /// 因为它根本没进候选（而不是因为水位挡住了）。
    #[test]
    fn today_and_future_never_become_candidates_even_with_a_future_watermark() {
        let root = temp_dir("today");
        let today = day("2026-11-07");
        for name in ["2026-11-07.md", "2026-11-08.md", "2099-01-01.md"] {
            fs::write(root.join(name), "x").expect("写样本");
        }
        let found = candidates(&root, today, 0, Some(day("2099-01-01")));
        assert!(found.is_empty(), "今天 / 未来 / 水位之前都不进候选，实际 {found:?}");

        /* 对照：水位在昨天时，昨天那份照删 —— 证明上一条不是因为候选集恒空。 */
        fs::write(root.join("2026-11-06.md"), "x").expect("写样本");
        let found: Vec<String> = candidates(&root, today, 0, Some(day("2026-11-05")))
            .into_iter()
            .map(|(_, name)| name)
            .collect();
        assert_eq!(found, vec!["2026-11-06.md".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    /// I3 / I4：水位挡住已扫过的日期；新过期的那一天仍然只出现一次。
    #[test]
    fn the_watermark_hides_already_scanned_dates() {
        let root = temp_dir("watermark");
        for name in ["2026-11-01.md", "2026-11-02.md", "2026-11-03.md"] {
            fs::write(root.join(name), "x").expect("写样本");
        }
        let today = day("2026-11-07");
        let found: Vec<String> = candidates(&root, today, 0, Some(day("2026-11-02")))
            .into_iter()
            .map(|(_, name)| name)
            .collect();
        assert_eq!(found, vec!["2026-11-03.md".to_string()], "水位及更早的都不再进候选");
        let _ = fs::remove_dir_all(&root);
    }

    /// 保留窗口：`keep = 1` 时昨天那份不删（Q1 的常数一旦改成 1，这条会跟着变）。
    #[test]
    fn keep_days_widens_the_window() {
        let root = temp_dir("keep");
        for name in ["2026-11-05.md", "2026-11-06.md"] {
            fs::write(root.join(name), "x").expect("写样本");
        }
        let found: Vec<String> = candidates(&root, day("2026-11-07"), 1, None)
            .into_iter()
            .map(|(_, name)| name)
            .collect();
        assert_eq!(found, vec!["2026-11-05.md".to_string()], "留 1 天时昨天那份不动");
        let _ = fs::remove_dir_all(&root);
    }

    /// 升序：水位推进依赖「按日期从小到大处理」，顺序错了水位就会跳过失败的中间项。
    #[test]
    fn candidates_are_sorted_ascending() {
        let root = temp_dir("sorted");
        for name in ["2026-11-03.md", "2026-11-01.md", "2026-11-02.md"] {
            fs::write(root.join(name), "x").expect("写样本");
        }
        let dates: Vec<NaiveDate> = candidates(&root, day("2026-11-07"), 0, None)
            .into_iter()
            .map(|(date, _)| date)
            .collect();
        assert_eq!(dates, vec![day("2026-11-01"), day("2026-11-02"), day("2026-11-03")]);
        let _ = fs::remove_dir_all(&root);
    }
}
