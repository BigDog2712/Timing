use reqwest::header::CONTENT_LENGTH;

use super::{map_reqwest, WebdavError};

/// Hard cap for a single Markdown snapshot response.
pub const MAX_MARKDOWN_BYTES: usize = 16 * 1024 * 1024;

pub(super) fn check_content_length(
    response: &reqwest::Response,
    limit: usize,
) -> Result<(), WebdavError> {
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > limit as u64)
    {
        return Err(WebdavError::TooLarge);
    }
    Ok(())
}

pub(super) async fn read_limited(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, WebdavError> {
    check_content_length(&response, limit)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(map_reqwest)? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(WebdavError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
