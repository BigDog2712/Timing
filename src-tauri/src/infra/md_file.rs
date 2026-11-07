//! Markdown 文件适配（只做 IO 与标题区块的拼接，业务判断在 `services::md_sync`）。
//!
//! ## 为什么只改「标题下的那一段」
//!
//! 日记里除了 Timing 的区块还有大量用户手写内容。同步只能是**外科手术**：
//! 找到目标标题行，替换到下一个同级或更高级标题之前，其余字节原样保留。
//!
//! ## 标题匹配规则
//!
//! - 标题行必须符合 CommonMark：`#` 后跟空格（`#### 事项计时`），`#` 之前最多 3 个空格；
//! - 区块结束于**下一个 level ≤ 当前 level 的标题**，所以区块里允许更深的子标题；
//! - 行尾空白不敏感，标题文本区分大小写；
//! - **代码围栏里的行不是标题**（`md_fence` / `md_section` 的判定，本文件只负责把同一份
//!   位图传给它们——围栏状态机在整个 crate 里只有一份，各写一份必然漂移）。
//!
//! 判定（哪些行算标题、区块到哪儿结束、三档诊断）全在 `infra::md_section`；本文件只剩
//! 读写与拼接，所以它变短了而不是撞 300 行门禁。
//!
//! ## 换行符
//!
//! 读入时把 `\r\n` 归一成 `\n`，写回时若原文件是 CRLF 再换回去。这样既不会把
//! Obsidian 的 Windows 文件整篇改成 LF，也不会让解析器到处处理 `\r`。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;

use super::md_fence;
use super::md_section::{self, SectionRead, SectionState};

/// UTF-8 BOM（`U+FEFF`）。
///
/// Windows 记事本「UTF-8 带 BOM」会把它写在文件最前面，而它**不属于**
/// `char::is_whitespace`——`line.trim()` 剥不掉，于是首行标题永远匹配不上，
/// 每轮同步都在末尾追加一节（文件无限增长）。所以读写入口统一先剥、写回时补。
const BOM: char = '\u{feff}';

/// 去掉开头的 BOM（没有就原样返回）。
fn strip_bom(text: &str) -> &str {
    text.strip_prefix(BOM).unwrap_or(text)
}

/// 解析落点路径：根目录 + 文件模板，模板里的日期令牌按本地日期替换。
///
/// [V0.11.6] 环境变量展开走 `infra::md_env`（+ `%APP_DIR%`）；本文件 298/300 行，
/// 塞不下那段逻辑，所以整段搬走并在这里 re-export，调用点路径不变。
pub fn resolve_path(root: &str, file: &str, date: NaiveDate) -> PathBuf {
    let root = expand_env(root);
    let file = expand_tokens(file.trim(), date);
    Path::new(&root).join(file)
}

pub use crate::infra::md_env::expand_env;

/// 把 `{date}` / `{yyyy}` / `{MM}` / `{dd}` 换成日期片段。
pub fn expand_tokens(template: &str, date: NaiveDate) -> String {
    template
        .replace("{date}", &date.format("%Y-%m-%d").to_string())
        .replace("{yyyy}", &date.format("%Y").to_string())
        .replace("{MM}", &date.format("%m").to_string())
        .replace("{dd}", &date.format("%d").to_string())
}

/// 读取目标区块；文件不存在 / 标题不存在都返回明确状态，不伪造空内容。
///
/// 返回 `SectionRead`：`.state` 是 v0.11.18 的三档状态 + 新增的 `Blocked`，
/// `.issues` 是诊断。**围栏位图在这里算一次、标题扫描也只一趟**，`section_end` 与
/// `diagnose` 吃的是同一份结果——任何一个自己再扫一遍都是本轮禁止的写法。
pub fn read_section(path: &Path, heading: &str) -> Result<SectionRead, String> {
    if !path.exists() {
        return Ok(SectionRead {
            state: SectionState::MissingFile,
            issues: Vec::new(),
        });
    }
    let meta = fs::metadata(path).map_err(|err| format!("读取文件信息失败：{err}"))?;
    if !meta.is_file() {
        return Err(format!("落点不是文件：{}", path.display()));
    }
    let raw = fs::read_to_string(path).map_err(|err| format!("读取文件失败：{err}"))?;
    let mtime_ms = mtime_ms(&meta);
    let text = strip_bom(&raw).replace("\r\n", "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let scan = md_section::scan_headings(&lines, &fences, heading);
    let head = scan.hit;
    let end = head.map_or(lines.len(), |(head_idx, level)| {
        md_section::section_end(&lines, &fences, head_idx, level)
    });
    let issues = md_section::diagnose(&fences, heading, &scan, end);
    /* 阻断级优先于「没找到标题」：`Mismatched` 恰恰发生在找不到配置标题时，
    若先落 MissingHeading 就会在文件末尾追加第二节（设计 §8.8 明确不许）。 */
    let state = if issues.iter().any(|issue| issue.blocks()) {
        SectionState::Blocked { mtime_ms }
    } else {
        match head {
            None => SectionState::MissingHeading { mtime_ms },
            Some((head_idx, _)) => SectionState::Present {
                body: trim_newlines(&lines[head_idx + 1..end].join("\n")),
                mtime_ms,
            },
        }
    };
    Ok(SectionRead { state, issues })
}

/// 写入目标区块（文件不存在则创建；标题不存在则追加到末尾）。
///
/// 返回写后的修改时刻（epoch ms），供同步器更新基线。
pub fn write_section(path: &Path, heading: &str, body: &str) -> Result<i64, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建落点目录失败：{err}"))?;
    }
    let (existing, had_crlf, had_bom) = if path.exists() {
        let raw = fs::read_to_string(path).map_err(|err| format!("读取文件失败：{err}"))?;
        (
            strip_bom(&raw).replace("\r\n", "\n"),
            raw.contains("\r\n"),
            raw.starts_with(BOM),
        )
    } else {
        (String::new(), false, false)
    };

    let body = body.replace("\r\n", "\n");
    let body = body.trim_end();
    let updated = if body_in_text(&existing, heading).is_some() {
        replace_in_text(&existing, heading, body)
    } else {
        append_section(&existing, heading, body)
    };
    /* [V0.4.1] 内容确实要变时先留底：区块边界判错就把用户手写内容写到别处去，
    没有副本就只能靠 OneDrive 历史版本。理由与保留策略见 `md_backup`。 */
    let backed_up = !existing.is_empty() && existing != updated;
    if backed_up {
        super::md_backup::save(path, &existing);
    }
    let updated = if had_crlf {
        updated.replace('\n', "\r\n")
    } else {
        updated
    };
    /* 原文件带 BOM 就写回去：只剥不补会让 Obsidian / 记事本的「UTF-8 with BOM」变成无 BOM。 */
    let payload = if had_bom {
        format!("{BOM}{updated}")
    } else {
        updated
    };

    write_atomic(path, payload.as_bytes())?;
    /* [V0.4.1] 写盘是「改动用户文件」的动作，正常一天也就几次，值得留一行。 */
    crate::log_info!(
        "md write: {} ({} bytes, backup={backed_up})",
        path.display(),
        payload.len()
    );
    let meta = fs::metadata(path).map_err(|err| format!("读取写入结果失败：{err}"))?;
    Ok(mtime_ms(&meta))
}

/// 从整篇 Markdown 里取出标题下的内容（不含标题行）。
///
/// 薄包装：与 `read_section` 走**同一套**判定（同一份围栏位图），但不出诊断——调用方
/// 是「恢复备份」与若干用例，它们要的是文本本身，不是三档诊断。
pub fn body_in_text(text: &str, heading: &str) -> Option<String> {
    let lines: Vec<&str> = text.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let (head_idx, level) = md_section::find_heading(&lines, &fences, heading)?;
    let end = md_section::section_end(&lines, &fences, head_idx, level);
    Some(trim_newlines(&lines[head_idx + 1..end].join("\n")))
}

/// 用 `body` 替换标题下的内容，保留标题行与后续内容。
pub fn replace_in_text(text: &str, heading: &str, body: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let fences = md_fence::scan(&lines);
    let Some((head_idx, level)) = md_section::find_heading(&lines, &fences, heading) else {
        return append_section(text, heading, body);
    };
    let end = md_section::section_end(&lines, &fences, head_idx, level);

    let mut out: Vec<&str> = Vec::with_capacity(lines.len() + 8);
    out.extend_from_slice(&lines[..=head_idx]);
    let body = body.trim_end();
    if body.is_empty() {
        out.push("");
    } else {
        out.extend(body.split('\n'));
    }
    if end < lines.len() {
        out.extend_from_slice(&lines[end..]);
    }
    let mut joined = out.join("\n");
    if !joined.ends_with('\n') {
        joined.push('\n');
    }
    joined
}

/// 在文档末尾追加一节（用于标题不存在 / 新文件）。
pub fn append_section(text: &str, heading: &str, body: &str) -> String {
    let mut out = text.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(heading.trim());
    out.push('\n');
    let body = body.trim_end();
    if !body.is_empty() {
        out.push_str(body);
        out.push('\n');
    }
    out
}

fn trim_newlines(value: &str) -> String {
    value.trim_matches('\n').to_string()
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// 同目录临时文件 + rename：写一半崩溃时不会留下半个区块。
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("md-sync");
    let tmp = parent.join(format!(".{name}.timing-{}.tmp", std::process::id()));
    {
        let mut file = fs::File::create(&tmp).map_err(|err| format!("创建临时文件失败：{err}"))?;
        file.write_all(bytes)
            .map_err(|err| format!("写入临时文件失败：{err}"))?;
        file.sync_all().map_err(|err| format!("刷盘失败：{err}"))?;
    }
    if let Err(err) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("替换文件失败：{err}"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "md_file_test.rs"]
mod tests;
