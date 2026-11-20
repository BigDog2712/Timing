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
mod parser_tags;

use crate::models::ai::{
    AiSuggestRequest, AiSuggestResponse, AiTagCandidate, AiTagMode, AiTagTarget,
};

/// 一级标签（用户口径 2026-11-19；2026-11-20 追加「工具」）：新建的标签必须落在这六类之下。
///
/// 为什么是白名单而不是「随便建」：没有约束的模型会把同一个意思写成
/// `娱乐` / `休闲` / `玩游戏` 三条，标签树两轮就散了；而白名单只要模型
/// 认得出「生活/工作/学习/娱乐/复盘/工具」，它自然会往下挂子标签。
///
/// 「工具」是 P0-9 的唯一真源：下载器 / 终端 / 截图 / 系统维护类应用归到它下面，
/// 前端按「一级标签是否为工具」把它们排除出统计（`shared/classification/toolTag.ts`）。
/// 前端那份只判定「是不是工具」，**不复制这份白名单全文** —— 否则两处各写一份，
/// 加第七类时会漂移。
pub const TAG_TOP_LEVELS: &[&str] = &["生活", "工作", "学习", "娱乐", "复盘", "工具"];

/// 打标规则的三层结构（2026-11-20 升级，PRD §3.1）：
///
///   · **匹配优先** —— 候选里有原样的 label 就复用，绝不改写、绝不造同义词；
///   · **应用侧看用途** —— 判断依据是三样（名称 / exe / 用途简介），不是只看名字；
///     多功能软件可以给**多个**一级标签，游戏只给「娱乐」，下载器 / 终端 / 截图 /
///     系统维护给「工具」；
///   · **事项侧自动建两级** —— 吃饭 → 生活/吃饭、写周报 → 工作/周报，且先匹配用户
///     已有候选，保证同类事项（以及同一个应用重复打标）稳定命中同一路径、不漂移。
///
/// 输出形状一个字都不能改：`{"suggestions":[{"id":"…","tags":["…"]}]}`
/// （`parser.rs` 只认这个形状，改文案时容易顺手改坏）。
pub const SYSTEM_SUGGEST: &str = r#"你是 Timing（本地计时应用）的标签分类器。

规则：
1. 先匹配候选标签：意思能对上就原样输出候选的 label（如 学习/考公），不要改写、不要另造同义词。
2. 候选里确实没有合适的，才新建标签。新建必须满足：
   - 一级只能是 生活 / 工作 / 学习 / 娱乐 / 复盘 / 工具 之一；
   - 最多两级，写成「父/子」（例：娱乐/燕云、学习/考公、工具/下载），不写 #、不写空格；
   - 同一意思只建一个，不要用近义词堆出多条；
   - 宁缺毋滥：拿不准就给空数组，不要为凑数建标签。
3. 应用侧（object 是「应用使用记录」）：判断依据是「软件名称 + exe + 它的用途/简介」，
   不能只看名字；名字看不出用途时按 exe 与简介推断，还看不出就给空数组。
   - 一个应用按其真实用途可以给**多个**一级标签：浏览器这类一个软件身兼数职的，
     工作 / 生活 / 学习 / 娱乐 都该给（Chrome → 工作、生活、学习、娱乐）；
   - 游戏只给「娱乐」，再挂一个子标签（燕云十六声 → 娱乐/燕云）；
   - 下载器 / 终端 / 截图 / 系统维护类给「工具」（IDM、Windows Terminal、Snipaste → 工具）；
   - 知识管理类可以同时是生活 / 学习 / 娱乐（Obsidian）；
   - 候选里已经有一级标签（生活 / 工作 / 学习 / 娱乐 / 复盘 / 工具）就直接复用那条 label，
     不要再新建成「工具/工具」这种与一级同名的子路径。
4. 事项侧（object 是「事项」）：没打标的事项要自动建两级标签，「父/子」写成这件事的
   归属与名字（吃饭 → 生活/吃饭，写周报 → 工作/周报）；先匹配候选里用户已有的标签，
   匹配得上就复用，保证同类事项稳定命中同一标签、不要来回漂移。
5. 每个对象最多 maxTags 个标签，按相关度从高到低；相关度低的宁可不给。
6. 对象自己的名字通常已经是同名标签（事项），不要再建议它。
7. 只输出 JSON，不要 Markdown 代码块，不要解释。格式：
{"suggestions":[{"id":"原样回传的 id","tags":["候选 label 或新建路径"]}]}
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
