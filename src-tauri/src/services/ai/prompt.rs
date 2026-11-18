//! 提示词与模型输出的收口：纯函数，不碰网络，便于用固定文本钉住「胡写时怎么办」。
//!
//! ## 输出为什么是严格 JSON
//!
//! 标签建议要直接落到 `items.tags` / 分类表，不能让模型回一段「我觉得它属于学习」。
//! 提示词给出唯一形状，解析层再兜底：去代码围栏、截首尾 `{}`、丢弃未知标签、
//! 数字 id 转字符串——**模型可以错，写库不能错**。
//!
//! ## 模型只认 label，不认 key
//!
//! 候选里有 `custom:category_ab12…` 这种键，让模型原样回传等于给它制造抄错的机会。
//! 所以提示词只给 label，解析时按「key 精确 → label（忽略大小写）唯一」折回 key；
//! 同一 label 有多个键时取第一个，剩下的交给用户在预览里改。

use serde_json::{json, Value};

mod parser;

use crate::models::ai::{
    AiSuggestRequest, AiSuggestResponse, AiTagCandidate, AiTagMode, AiTagTarget,
};

pub const SYSTEM_SUGGEST: &str = r#"你是 Timing（本地计时应用）的标签分类器。

规则：
1. 只能从候选标签里选，禁止创造新标签；候选的 label 是给人看的路径（如 学习/考公）。
2. 每个对象最多 maxTags 个标签，按相关度从高到低；拿不准就给空数组，宁缺毋滥。
3. 对象自己的名字通常已经是同名标签（事项），不要再建议它。
4. 只输出 JSON，不要 Markdown 代码块，不要解释。格式：
{"suggestions":[{"id":"原样回传的 id","tags":["候选 label"]}]}
"#;

pub const SYSTEM_DAILY: &str = r#"你是时间管理助理，根据用户当天的事实数据写一份简体中文总结。

要求：
1. 只使用输入 JSON 里的数据，不编造未出现的应用、事项或时长。
2. Markdown：短段落 + 无序列表；不要一级标题，不要表格，不要代码块。
3. 先给两句话总览（总时长、最投入的方向），再列 3-5 条观察，最后一句轻量建议。
4. 语气克制，不评价用户的生活方式，不做医疗或心理判断。
"#;

pub fn suggest_prompt(req: &AiSuggestRequest, max: u8) -> String {
    let object = match req.mode {
        AiTagMode::Item => "事项",
        AiTagMode::App => "应用使用记录",
    };
    let candidates: Vec<Value> = req
        .candidates
        .iter()
        .map(|candidate| json!({ "label": candidate.label }))
        .collect();
    let targets: Vec<Value> = req
        .targets
        .iter()
        .map(|target| json!({ "id": target.id, "text": target.text }))
        .collect();
    json!({
        "object": object,
        "maxTags": max,
        "candidates": candidates,
        "targets": targets,
    })
    .to_string()
}

/// 解析建议。返回顺序跟着 `targets`，空建议的条目被丢弃。
pub fn parse_suggestions(
    raw: &str,
    targets: &[AiTagTarget],
    candidates: &[AiTagCandidate],
    max: u8,
) -> AiSuggestResponse {
    parser::parse_suggestions(raw, targets, candidates, max)
}

/// 汇总正文要嵌进 `#### AI 今日汇总` 之下：任何 `#` 标题都会提前结束区块
/// （`md_file` 按标题级别找边界），所以一律降成加粗行。整段代码围栏也剥掉。
pub fn sanitize_markdown(raw: &str) -> String {
    let body = strip_wrapping_fence(raw.trim());
    let mut out = String::new();
    for line in body.lines() {
        let trimmed = line.trim_start();
        let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
        if (1..=6).contains(&hashes) && trimmed.chars().nth(hashes) == Some(' ') {
            let text = trimmed[hashes..].trim();
            if !text.is_empty() {
                out.push_str(&format!("**{text}**\n"));
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    truncate_chars(out.trim(), 8000)
}

fn strip_wrapping_fence(text: &str) -> &str {
    if !text.starts_with("```") {
        return text;
    }
    let after = text
        .find('\n')
        .map(|index| &text[index + 1..])
        .unwrap_or("");
    after
        .trim_end()
        .strip_suffix("```")
        .unwrap_or(after)
        .trim_end()
}

fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let cut: String = text.chars().take(limit).collect();
    format!("{cut}\n\n（内容过长，已截断）")
}

#[cfg(test)]
#[path = "prompt/tests.rs"]
mod tests;
