//! Canonical item tag path rules; kept parallel with `src/windows/shared/tags/normalize.ts`.
use crate::error::{AppError, AppResult, ErrorCode};

pub const MAX_TAGS: usize = 32;
pub const MAX_TAG_LEN: usize = 64;
pub const MAX_TAG_DEPTH: usize = 4;
pub const MAX_TAG_SEGMENT_LEN: usize = 32;

pub fn normalize_tag_paths(values: &[String], maximum: usize) -> AppResult<Vec<String>> {
    if values.len() > maximum {
        return Err(invalid_tag(format!("最多只能设置 {maximum} 个标签")));
    }
    let mut result = Vec::new();
    for value in values {
        let path = normalize_tag_path(value)?;
        if path.is_empty() {
            continue;
        }
        if !result
            .iter()
            .any(|item: &String| case_key(item) == case_key(&path))
        {
            result.push(path);
        }
    }
    Ok(result)
}

fn case_key(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character == '\u{03c2}' {
                '\u{03c3}'
            } else {
                character
            }
        })
        .collect()
}

pub fn normalize_tag_path(raw: &str) -> AppResult<String> {
    let source = raw.trim().trim_start_matches('#').replace('\\', "/");
    if source.chars().any(char::is_control) {
        return Err(invalid_tag("标签不能包含控制字符"));
    }
    let segments: Vec<&str> = source
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if segments.iter().any(|part| part.contains('#')) {
        return Err(invalid_tag("标签中的 # 只能出现在开头"));
    }
    if segments.len() > MAX_TAG_DEPTH {
        return Err(invalid_tag("标签最多支持 4 级路径"));
    }
    if segments
        .iter()
        .any(|part| part.chars().count() > MAX_TAG_SEGMENT_LEN)
    {
        return Err(invalid_tag("标签单级长度不能超过 32 个字符"));
    }
    let path = segments.join("/");
    if path.chars().count() > MAX_TAG_LEN {
        return Err(invalid_tag("标签路径长度不能超过 64 个字符"));
    }
    Ok(path)
}

fn invalid_tag(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::InvalidTagPath, message)
}

#[cfg(test)]
mod tests {
    use super::{normalize_tag_path, normalize_tag_paths};
    use serde::Deserialize;

    const FIXTURE: &str = include_str!("../../../src/windows/shared/tags/fixtures/tag-path.json");

    #[derive(Deserialize)]
    struct Fixture {
        cases: Vec<PathCase>,
        #[serde(rename = "listCases")]
        list_cases: Vec<ListCase>,
    }

    #[derive(Deserialize)]
    struct PathCase {
        name: String,
        input: String,
        expected: Option<String>,
        error: Option<String>,
    }

    #[derive(Deserialize)]
    struct ListCase {
        name: String,
        input: Vec<String>,
        expected: Vec<String>,
    }

    #[test]
    fn matches_shared_tag_path_fixture() {
        let fixture: Fixture = serde_json::from_str(FIXTURE).expect("tag fixture must parse");
        for case in fixture.cases {
            let actual = normalize_tag_path(&case.input);
            if case.error.is_some() {
                assert!(actual.is_err(), "{} should be rejected", case.name);
            } else {
                assert_eq!(
                    actual.expect("valid fixture case"),
                    case.expected.expect("expected path"),
                    "{}",
                    case.name
                );
            }
        }
        for case in fixture.list_cases {
            let actual = normalize_tag_paths(&case.input, 32).expect("valid tag list");
            assert_eq!(actual, case.expected, "{}", case.name);
        }
    }
}
