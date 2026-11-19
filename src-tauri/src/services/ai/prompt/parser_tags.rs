//! 标签的归一与新建守门（`parser.rs` 的标签层）。
//!
//! ## 两种结局：命中候选、或按规则新建
//!
//! 候选命中优先（key 精确 → 归一后再比 → label 忽略大小写），这一步保证
//! 「已有标签不会被换个写法重复建一条」。候选里确实没有，才走 `sanitize_new_tag`：
//! 一级必须是 `TAG_TOP_LEVELS` 之一、最多两级、空名 / 控制字符一律丢弃 ——
//! 模型可以错，写进 `items.tags` 的东西不能错。

use crate::models::ai::AiTagCandidate;
use crate::models::tag_path::normalize_tag_path;
use crate::services::ai::prompt::TAG_TOP_LEVELS;

/// 新建标签最多两级（`娱乐/燕云`）。再深就不是标签，而是分类树了。
const NEW_TAG_MAX_DEPTH: usize = 2;

/// 逐条归一：候选命中取候选的键，否则尝试新建。返回（最终标签，新建的那些）。
pub(super) fn resolve_tags(
    tags: &[String],
    candidates: &[AiTagCandidate],
    max: u8,
) -> (Vec<String>, Vec<String>) {
    let limit = usize::from(max.clamp(1, 8));
    let mut resolved: Vec<String> = Vec::new();
    let mut created: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for text in tags {
        let Some(tag) = resolve_tag(text, candidates) else {
            continue;
        };
        let key = tag.to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        if !candidates.iter().any(|candidate| candidate.key == tag) {
            created.push(tag.clone());
        }
        resolved.push(tag);
        if resolved.len() == limit {
            break;
        }
    }
    (resolved, created)
}

/// 新建标签的守门人：一级白名单 + 最多两级 + 合法的路径。
///
/// `娱乐-燕云` 这种「父类-子类」写法一并接受（用户与模型的习惯写法），
/// 但只在**没有斜杠**且前半段正好是一级标签时转换，避免把 `AI-编程` 这类
/// 本来就想带连字符的名字改坏。
fn sanitize_new_tag(raw: &str) -> Option<String> {
    let clean = raw.trim().trim_start_matches('#').trim();
    if clean.is_empty() {
        return None;
    }
    let candidate = if clean.contains('/') {
        clean.to_string()
    } else {
        match clean.split_once('-') {
            Some((parent, child)) if TAG_TOP_LEVELS.contains(&parent.trim()) => {
                format!("{}/{}", parent.trim(), child.trim())
            }
            _ => clean.to_string(),
        }
    };
    let path = normalize_tag_path(&candidate).ok()?;
    if path.is_empty() || path.split('/').count() > NEW_TAG_MAX_DEPTH {
        return None;
    }
    let top = path.split('/').next()?;
    TAG_TOP_LEVELS.contains(&top).then_some(path)
}

fn resolve_tag(raw: &str, candidates: &[AiTagCandidate]) -> Option<String> {
    let clean = raw.trim().trim_start_matches('#').trim().replace('\\', "/");
    if clean.is_empty() {
        return None;
    }
    if let Some(hit) = candidates.iter().find(|candidate| candidate.key == clean) {
        return Some(hit.key.clone());
    }
    /* 先归一再去比对：模型常写 `学习/`（尾部斜杠）、`#娱乐`、`娱乐 // 燕云`。
       拿原始串去比 label 会匹配不上，然后被 `sanitize_new_tag` 归一成一条**与已有
       标签同名的新标签** —— 库里出现两条看着一样的标签，这正是要避免的重复。 */
    let canonical = normalize_tag_path(&clean).ok().filter(|path| !path.is_empty());
    if let Some(path) = &canonical {
        if let Some(hit) = candidates.iter().find(|candidate| &candidate.key == path) {
            return Some(hit.key.clone());
        }
        let lowered = path.to_lowercase();
        if let Some(hit) = candidates
            .iter()
            .find(|candidate| label_key(candidate) == lowered)
        {
            return Some(hit.key.clone());
        }
    }
    let lowered = clean.to_lowercase();
    if let Some(hit) = candidates
        .iter()
        .find(|candidate| label_key(candidate) == lowered)
    {
        return Some(hit.key.clone());
    }
    sanitize_new_tag(&clean)
}

fn label_key(candidate: &AiTagCandidate) -> String {
    candidate
        .label
        .trim()
        .trim_start_matches('#')
        .trim()
        .to_lowercase()
}
