//! 待办区块的渲染 / 解析（从 `format.rs` 拆出，守住单文件 ≤300 行）。
//!
//! ~~~text
//! - [ ] 写季度总结 · 计划 2026-10-21 09:00 <!-- tb-todo:12 -->
//! - [ ] 整理下载目录 · 逾期 2026-10-18 14:00 <!-- tb-todo:15 -->
//! - [ ] 备选方案 <!-- tb-todo:7 -->
//! ~~~
//!
//! 三个约定，缺一不可：
//!
//! 1. `<!-- tb-todo:N -->` 是行 id（Obsidian 预览视图里不显示）。没有 id = 用户在
//!    Obsidian 里新写的一行，导入时新建待办。
//! 2. `· 计划 <时间>` / `· 逾期 <时间>` 是**计划时间的唯一事实来源**——直接改这一段
//!    就会回写到数据库的 `planned_at`。解析不出来时（比如写成「· 计划 下周」）
//!    整段当标题的一部分保留，绝不误剥。
//! 3. `- [ ]` / `- [x]` 是完成状态：改成 `[x]` 会回写 `done_at`，下一轮导出它就从
//!    区块里消失了（完成的待办不再是「未来要做的」）。
//!
//! 「逾期」只是渲染时的措辞：`planned_at` 早于今天 0 点就是逾期，两者的解析规则
//! 完全一样，用户把 `逾期` 改成 `计划` 也能正常读回。

use chrono::NaiveDate;

use super::{day_bounds, format_minute, parse_planned};

/// 待办区块里的一行。`id=None` = Markdown 里新加的行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoRow {
    pub id: Option<i64>,
    pub title: String,
    pub planned_ms: Option<i64>,
    pub done: bool,
}

/// 渲染待办区块（不含标题行）。没有待办时返回空串，不往日记里塞空区块。
///
/// 排序在渲染侧固定（计划时间升序，未排期最后），保证「导入 → 重渲染」后顺序
/// 规范化：用户把行上下挪动只影响标题顺序，不会被同步器原样写回、来回震荡。
pub fn render_todos(rows: &[TodoRow], today: NaiveDate) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let (today_start, _) = day_bounds(today);

    let mut sorted: Vec<(usize, &TodoRow)> = rows.iter().enumerate().collect();
    sorted.sort_by_key(|(index, row)| {
        (
            row.planned_ms.is_none(),
            row.planned_ms.unwrap_or(0),
            *index,
        )
    });

    let mut out = String::new();
    for (_, row) in sorted {
        let mark = if row.done { 'x' } else { ' ' };
        out.push_str(&format!("- [{mark}] {}", sanitize(&row.title)));
        if let Some(ms) = row.planned_ms {
            let label = if ms < today_start { "逾期" } else { "计划" };
            out.push_str(&format!(" · {label} {}", format_minute(ms)));
        }
        if let Some(id) = row.id {
            out.push_str(&format!(" <!-- tb-todo:{id} -->"));
        }
        out.push('\n');
    }
    out.trim_end().to_string()
}

/// 解析待办区块。`today` 用来补全没写年份的计划时间（见 `parse_planned`）。
///
/// 只认 `- [ ]` / `- [x]` 清单项；标题为空且没有 id 的行直接丢弃。
pub fn parse_todos(body: &str, today: NaiveDate) -> Vec<TodoRow> {
    let mut rows = Vec::new();
    for raw in body.lines() {
        let line = raw.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some((done, rest)) = checkbox(line) else {
            continue;
        };
        let (text, id) = strip_id_marker(rest);
        let (title, planned_ms) = split_plan(&text, today);
        if title.is_empty() && id.is_none() {
            continue;
        }
        rows.push(TodoRow {
            id,
            title,
            planned_ms,
            done,
        });
    }
    rows
}

/// `- [ ] xxx` / `- [x] xxx` → `(是否完成, 剩余文本)`。
fn checkbox(line: &str) -> Option<(bool, &str)> {
    for prefix in ["- [ ]", "* [ ]", "+ [ ]"] {
        if let Some(rest) = line.strip_prefix(prefix) {
            return Some((false, rest));
        }
    }
    for prefix in ["- [x]", "- [X]", "* [x]", "* [X]", "+ [x]", "+ [X]"] {
        if let Some(rest) = line.strip_prefix(prefix) {
            return Some((true, rest));
        }
    }
    None
}

/// 从行尾取 `<!-- tb-todo:12 -->`，返回 `(正文, id)`。
fn strip_id_marker(text: &str) -> (String, Option<i64>) {
    /* 从最后一个 `<!--` 找起：标题里可能本来就有注释，不能把第一个当 id。 */
    let Some(start) = text.rfind("<!--") else {
        return (text.trim().to_string(), None);
    };
    let marker = text[start..].trim_end();
    let Some(inner) = marker
        .strip_prefix("<!--")
        .and_then(|value| value.strip_suffix("-->"))
    else {
        return (text.trim().to_string(), None);
    };
    let Some(id) = inner
        .trim()
        .strip_prefix("tb-todo:")
        .and_then(|value| value.trim().parse::<i64>().ok())
    else {
        return (text.trim().to_string(), None);
    };
    (text[..start].trim().to_string(), Some(id))
}

/// 剥掉行尾 ` · 计划 <时间>` / ` · 逾期 <时间>`，返回 `(标题, 计划时刻)`。
///
/// 只有「后缀能解析成一个真实时刻」才剥；解析失败就当标题的一部分，所以
/// 「复盘 · 计划 下周再定」这种写法不会被吃掉。
fn split_plan(text: &str, today: NaiveDate) -> (String, Option<i64>) {
    let text = text.trim();
    let Some(pos) = text.rfind(" · ") else {
        return (text.to_string(), None);
    };
    let tail = &text[pos + " · ".len()..];
    for prefix in ["计划 ", "逾期 "] {
        let Some(value) = tail.strip_prefix(prefix) else {
            continue;
        };
        if let Some(ms) = parse_planned(value, today) {
            return (text[..pos].trim().to_string(), Some(ms));
        }
    }
    (text.to_string(), None)
}

fn sanitize(raw: &str) -> String {
    raw.replace(['\n', '\r'], " ").trim().to_string()
}
