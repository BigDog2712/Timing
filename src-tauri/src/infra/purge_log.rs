//! 往期清理的**追责面**（V0.11.19 变更 A，设计 §3.7）：`data\logs\md-cloud-purge.log`。
//!
//! 与主日志的分工：
//! - 主日志（`timing-YYYY-MM-DD.log`）按天滚动，是**判据**面（QA 照设计 §11.3 grep 它）；
//! - 本文件固定一个名字、一行一条、保留最近 `MD_CLOUD_PURGE_LOG_KEEP`（400）行，是
//!   **事后追责**面（PRD §2.8 风险 7）：主人三个月后想知道「哪天删了哪几份」时，
//!   主日志早就滚没了，而这里还连着。
//!
//! ## 它不参与任何判据
//!
//! 写失败只记一条 WARN 就返回：追责面**不许反过来卡住主流程**。清理是破坏性操作，
//! 一个「日志目录恰好不可写」的机器不该因此删不掉往期（反过来也不该因为写不了追责日志
//! 而误以为删成功了——那条判断在 HTTP 状态码与 `fs` 返回值上，不在这里）。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use crate::models::constants::MD_CLOUD_PURGE_LOG_KEEP;

/// 固定文件名：不随日期滚动（要看的正是「连着几天删了什么」）。
const FILE_NAME: &str = "md-cloud-purge.log";

/// 记一行 `<date>\t<outcome>\t<本地时间 ISO>`。
///
/// `outcome` 是 `status=204` 或 `removed`（两路各一套口径，与主日志同一个词）。
pub fn append(date: &str, outcome: &str) {
    /* 日志目录没注入（单测 / 手机端）就静默返回：这条链路不该为「没有日志目录」做任何事。 */
    let Some(dir) = crate::platform::log::log_dir() else {
        return;
    };
    let path = dir.join(FILE_NAME);
    let stamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S");
    let line = format!("{date}\t{outcome}\t{stamp}\n");
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
        crate::log_warn!("追责日志打不开：{FILE_NAME}（不影响清理）");
        return;
    };
    if file.write_all(line.as_bytes()).is_err() {
        crate::log_warn!("追责日志写不进：{FILE_NAME}（不影响清理）");
        return;
    }
    drop(file);
    trim(&path);
}

/// 超过上限时整文件重写成最后那几百行。
///
/// 只在超限那一刻重写（不是每次追加都重写）：一批 20 条就是 20 次 open/append，
/// 每次都读全文再写回会把这条「顺便记一笔」的路变成磁盘上最贵的动作。
fn trim(path: &Path) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= MD_CLOUD_PURGE_LOG_KEEP {
        return;
    }
    let keep = &lines[lines.len() - MD_CLOUD_PURGE_LOG_KEEP..];
    let mut body = keep.join("\n");
    body.push('\n');
    if fs::write(path, body).is_err() {
        crate::log_warn!("追责日志截断失败：{FILE_NAME}（不影响清理）");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("timing-purge-log-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("建临时目录");
        let path = dir.join(FILE_NAME);
        fs::write(&path, "").expect("建空文件");
        path
    }

    /// 上限之外的旧行必须被丢掉，且**保留的是最后那几行**（追责要的是最近发生了什么）。
    #[test]
    fn trim_keeps_only_the_newest_lines() {
        let path = temp_file("trim");
        let mut body = String::new();
        for index in 0..(MD_CLOUD_PURGE_LOG_KEEP + 5) {
            body.push_str(&format!("2026-11-01\tremoved\t#{index}\n"));
        }
        fs::write(&path, body).expect("写满");

        trim(&path);

        let text = fs::read_to_string(&path).expect("读回");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), MD_CLOUD_PURGE_LOG_KEEP, "要截到上限");
        assert!(
            lines.first().is_some_and(|line| line.ends_with("#5")),
            "截掉的必须是**最旧**那几行，实际首行 {:?}",
            lines.first()
        );
        let _ = fs::remove_dir_all(path.parent().expect("有父目录"));
    }
}
