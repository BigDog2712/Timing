//! 便利贴表格的渲染 / 解析（从 `format.rs` 拆出，守住单文件 ≤300 行）。
//!
//! 三列表格，行尾用 HTML 注释带隐藏 id：
//!
//! ```text
//! | 更新时间 | 事项 | 内容 |
//! |---|---|---|
//! | 2026-10-20 09:30:00 | 生活 | 买牛奶 <!-- tb-note:3 --> |
//! ```
//!
//! 没有 id 的行 = 用户在 Markdown 里新增的便利贴；id 消失 = 删除。

use super::{format_ts, NoteRow};

/// 渲染便利贴表格（不含标题行）。没有数据时返回空串，避免往日记里塞空表。
pub fn render_notes(rows: &[NoteRow]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let mut sorted = rows.to_vec();
    sorted.sort_by_key(|row| (row.updated_ms, row.id.unwrap_or(i64::MAX)));

    let mut out = String::from("| 更新时间 | 事项 | 内容 |\n|---|---|---|\n");
    for row in sorted {
        let time = if row.updated_ms > 0 {
            format_ts(row.updated_ms)
        } else {
            String::new()
        };
        let item = row
            .item
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("—")
            .replace('|', "\\|")
            .replace(['\n', '\r'], " ");
        let mut content = row.content.replace('|', "\\|").replace('\n', "<br>");
        if let Some(id) = row.id {
            content.push_str(&format!(" <!-- tb-note:{id} -->"));
        }
        out.push_str(&format!("| {time} | {item} | {content} |\n"));
    }
    out.trim_end().to_string()
}

/// 解析便利贴表格。表头、分隔行、缺列的行都跳过。
pub fn parse_notes(body: &str) -> Vec<NoteRow> {
    let mut rows = Vec::new();
    for raw in body.lines() {
        let line = raw.trim();
        if !line.starts_with('|') {
            continue;
        }
        let cells = split_row(line);
        if cells.len() < 3 || cells[0].contains("更新时间") {
            continue;
        }
        if cells
            .iter()
            .all(|cell| cell.chars().all(|ch| ch == '-' || ch == ':'))
        {
            continue;
        }
        if cells.iter().all(|cell| cell.is_empty()) {
            continue;
        }
        let (content, id) = strip_marker(&cells[2]);
        let content = content
            .replace("<br/>", "\n")
            .replace("<br />", "\n")
            .replace("<br>", "\n")
            .trim()
            .to_string();
        if content.is_empty() && id.is_none() {
            continue;
        }
        rows.push(NoteRow {
            id,
            updated_ms: super::parse_ts(&cells[0]).unwrap_or(0),
            item: normalize_item(&cells[1]),
            content,
        });
    }
    rows
}

fn normalize_item(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() || value == "—" || value == "-" {
        None
    } else {
        Some(value.to_string())
    }
}

/// 按未转义的 `|` 切表格行；`\|` 还原成普通竖线。
fn split_row(line: &str) -> Vec<String> {
    let trimmed = line.trim().trim_matches('|');
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut chars = trimmed.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' && chars.peek() == Some(&'|') {
            chars.next();
            current.push('|');
        } else if ch == '|' {
            cells.push(current.trim().to_string());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    cells.push(current.trim().to_string());
    cells
}

/// 去掉行尾 `<!-- tb-note:12 -->`，返回 `(正文, id)`。
fn strip_marker(cell: &str) -> (String, Option<i64>) {
    /* 从最后一个注释找起：正文里可能本来就有 `<!-- ... -->`，不能把第一个当成 id。 */
    let Some(start) = cell.rfind("<!--") else {
        return (cell.to_string(), None);
    };
    let marker = cell[start..].trim_end();
    let Some(inner) = marker
        .strip_prefix("<!--")
        .and_then(|value| value.strip_suffix("-->"))
    else {
        return (cell.to_string(), None);
    };
    let Some(id) = inner
        .trim()
        .strip_prefix("tb-note:")
        .and_then(|value| value.trim().parse::<i64>().ok())
    else {
        return (cell.to_string(), None);
    };
    (cell[..start].to_string(), Some(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::md_sync::format::parse_ts;

    fn ms(text: &str) -> i64 {
        parse_ts(text).expect("时间应可解析")
    }

    #[test]
    fn notes_roundtrip_with_pipes_and_newlines() {
        let rows = vec![NoteRow {
            id: Some(7),
            updated_ms: ms("2026-10-20 09:30:00"),
            item: Some("生活".into()),
            content: "第一行 | 带竖线\n第二行".into(),
        }];
        let body = render_notes(&rows);
        assert!(body.contains("第一行 \\| 带竖线<br>第二行"));
        assert!(body.contains("<!-- tb-note:7 -->"));
        let parsed = parse_notes(&body);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, Some(7));
        assert_eq!(parsed[0].content, "第一行 | 带竖线\n第二行");
        assert_eq!(parsed[0].item.as_deref(), Some("生活"));
    }

    #[test]
    fn note_without_marker_means_new_note() {
        let body =
            "| 更新时间 | 事项 | 内容 |\n|---|---|---|\n| 2026-10-20 09:30:00 | — | 新便利贴 |";
        let parsed = parse_notes(body);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, None);
        assert_eq!(parsed[0].item, None);
    }

    #[test]
    fn item_name_with_pipe_keeps_table_shape() {
        let rows = vec![NoteRow {
            id: Some(3),
            updated_ms: ms("2026-10-20 09:30:00"),
            item: Some("生|活".into()),
            content: "买牛奶".into(),
        }];
        let parsed = parse_notes(&render_notes(&rows));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].item.as_deref(), Some("生|活"));
        assert_eq!(parsed[0].content, "买牛奶");
    }

    #[test]
    fn content_comment_does_not_hide_the_id_marker() {
        let rows = vec![NoteRow {
            id: Some(9),
            updated_ms: ms("2026-10-20 09:30:00"),
            item: None,
            content: "前 <!-- 用户注释 --> 后".into(),
        }];
        let parsed = parse_notes(&render_notes(&rows));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, Some(9));
        assert_eq!(parsed[0].content, "前 <!-- 用户注释 --> 后");
    }

    #[test]
    fn empty_notes_render_to_empty_string() {
        assert!(render_notes(&[]).is_empty());
    }
}
