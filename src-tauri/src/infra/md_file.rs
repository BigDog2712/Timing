//! Markdown 文件适配（只做 IO 与标题区块的拼接，业务判断在 `services::md_sync`）。
//!
//! ## 为什么只改「标题下的那一段」
//!
//! 日记里除了 TickBar 的区块还有大量用户手写内容。同步只能是**外科手术**：
//! 找到目标标题行，替换到下一个同级或更高级标题之前，其余字节原样保留。
//!
//! ## 标题匹配规则
//!
//! - 标题行必须符合 CommonMark：`#` 后跟空格（`#### 事项计时`）；
//! - 区块结束于**下一个 level ≤ 当前 level 的标题**，所以区块里允许更深的子标题；
//! - 行尾空白不敏感，标题文本区分大小写。
//!
//! ## 换行符
//!
//! 读入时把 `\r\n` 归一成 `\n`，写回时若原文件是 CRLF 再换回去。这样既不会把
//! Obsidian 的 Windows 文件整篇改成 LF，也不会让解析器到处处理 `\r`。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;

/// 读一个目标区块的结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SectionState {
    /// 文件不存在（父目录也不一定存在）。
    MissingFile,
    /// 文件存在，但没有目标标题行。
    MissingHeading { mtime_ms: i64 },
    /// 找到标题行；`body` 是标题与下一个同级标题之间的内容（已去掉首尾空行）。
    Present { body: String, mtime_ms: i64 },
}

/// 解析落点路径：根目录 + 文件模板，模板里的日期令牌按本地日期替换。
pub fn resolve_path(root: &str, file: &str, date: NaiveDate) -> PathBuf {
    let root = expand_env(root);
    let file = expand_tokens(file.trim(), date);
    Path::new(&root).join(file)
}

/// 展开 `%USERPROFILE%` 与开头的 `~`。找不到环境变量时原样保留，让路径错误可诊断。
pub fn expand_env(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    if text == "~" || text.starts_with("~\\") || text.starts_with("~/") {
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            text = format!("{}{}", home, &text[1..]);
        }
    }

    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '%' {
            out.push(ch);
            continue;
        }
        let mut name = String::new();
        let mut closed = false;
        for next in chars.by_ref() {
            if next == '%' {
                closed = true;
                break;
            }
            name.push(next);
        }
        if closed {
            match std::env::var(&name) {
                Ok(value) => out.push_str(&value),
                Err(_) => {
                    out.push('%');
                    out.push_str(&name);
                    out.push('%');
                }
            }
        } else {
            out.push('%');
            out.push_str(&name);
        }
    }
    out
}

/// 把 `{date}` / `{yyyy}` / `{MM}` / `{dd}` 换成日期片段。
pub fn expand_tokens(template: &str, date: NaiveDate) -> String {
    template
        .replace("{date}", &date.format("%Y-%m-%d").to_string())
        .replace("{yyyy}", &date.format("%Y").to_string())
        .replace("{MM}", &date.format("%m").to_string())
        .replace("{dd}", &date.format("%d").to_string())
}

/// 读取目标区块；文件不存在 / 标题不存在都返回明确状态，不伪造空内容。
pub fn read_section(path: &Path, heading: &str) -> Result<SectionState, String> {
    if !path.exists() {
        return Ok(SectionState::MissingFile);
    }
    let meta = fs::metadata(path).map_err(|err| format!("读取文件信息失败：{err}"))?;
    if !meta.is_file() {
        return Err(format!("落点不是文件：{}", path.display()));
    }
    let raw = fs::read_to_string(path).map_err(|err| format!("读取文件失败：{err}"))?;
    let mtime_ms = mtime_ms(&meta);
    let text = raw.replace("\r\n", "\n");
    match body_in_text(&text, heading) {
        Some(body) => Ok(SectionState::Present { body, mtime_ms }),
        None => Ok(SectionState::MissingHeading { mtime_ms }),
    }
}

/// 写入目标区块（文件不存在则创建；标题不存在则追加到末尾）。
///
/// 返回写后的修改时刻（epoch ms），供同步器更新基线。
pub fn write_section(path: &Path, heading: &str, body: &str) -> Result<i64, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建落点目录失败：{err}"))?;
    }
    let (existing, had_crlf) = if path.exists() {
        let raw = fs::read_to_string(path).map_err(|err| format!("读取文件失败：{err}"))?;
        (raw.replace("\r\n", "\n"), raw.contains("\r\n"))
    } else {
        (String::new(), false)
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

    write_atomic(path, updated.as_bytes())?;
    /* [V0.4.1] 写盘是「改动用户文件」的动作，正常一天也就几次，值得留一行。 */
    crate::log_info!(
        "md write: {} ({} bytes, backup={backed_up})",
        path.display(),
        updated.len()
    );
    let meta = fs::metadata(path).map_err(|err| format!("读取写入结果失败：{err}"))?;
    Ok(mtime_ms(&meta))
}

/// 从整篇 Markdown 里取出标题下的内容（不含标题行）。
pub fn body_in_text(text: &str, heading: &str) -> Option<String> {
    let lines: Vec<&str> = text.split('\n').collect();
    let (head_idx, level) = find_heading(&lines, heading)?;
    let end = section_end(&lines, head_idx, level);
    Some(trim_newlines(&lines[head_idx + 1..end].join("\n")))
}

/// 用 `body` 替换标题下的内容，保留标题行与后续内容。
pub fn replace_in_text(text: &str, heading: &str, body: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let Some((head_idx, level)) = find_heading(&lines, heading) else {
        return append_section(text, heading, body);
    };
    let end = section_end(&lines, head_idx, level);

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

/// 返回 `(标题行下标, 标题等级)`。
fn find_heading(lines: &[&str], heading: &str) -> Option<(usize, usize)> {
    let target = heading.trim();
    lines
        .iter()
        .enumerate()
        .find(|(_, line)| line.trim() == target && heading_level(line).is_some())
        .and_then(|(idx, line)| heading_level(line).map(|level| (idx, level)))
}

/// 区块结束行：下一个 level ≤ 当前 level 的标题；没有则到文件末尾。
fn section_end(lines: &[&str], head_idx: usize, level: usize) -> usize {
    lines
        .iter()
        .enumerate()
        .skip(head_idx + 1)
        .find(|(_, line)| heading_level(line).is_some_and(|next| next <= level))
        .map(|(idx, _)| idx)
        .unwrap_or(lines.len())
}

fn heading_level(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let level = trimmed.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = &trimmed[level..];
    if rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t') {
        Some(level)
    } else {
        None
    }
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
    let tmp = parent.join(format!(".{name}.tickbar-{}.tmp", std::process::id()));
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
