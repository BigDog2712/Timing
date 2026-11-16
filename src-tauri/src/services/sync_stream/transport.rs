//! 事件流的传输层：把「写不可变分段 / 读分段 / 列设备目录」抽象成一套接口。
//!
//! 两条真实通路 + 一条测试通路：
//!
//! - [`Transport::Folder`]：本地目录（`round_folder` 那轮，零网络，上传交给用户自己的
//!   网盘客户端）；
//! - [`Transport::Webdav`]：HTTP（`round_webdav` 那轮，Timing 自己发请求）；
//! - 测试用 [`Memory`]（见 `mod.rs` 的用例，不落盘、可断言传输字节）。
//!
//! 错误统一折成 `String`（不折 `AppError`）：架构设计 §7「云端失败不折成 AppError，
//! 进 report.errors」——传输层的失败由编排层决定怎么记，本层不替它做主。

use std::path::{Component, Path, PathBuf};

use crate::infra::md_webdav::{self, WebdavError, WebdavTarget};

/// 事件流传输落点。
#[derive(Debug, Clone)]
pub enum Transport {
    /// 本地目录根（相对路径 `sync/events/...` 会拼在它下面）。
    Folder(PathBuf),
    /// WebDAV 远端。
    Webdav(WebdavTarget),
}

impl Transport {
    /// 写一份「只允许不存在」的不可变分段。已存在返回 `Ok(false)`（不覆盖）。
    pub async fn put_if_absent(&self, rel: &str, bytes: &[u8]) -> Result<bool, String> {
        match self {
            Transport::Folder(root) => {
                let path = join(root, rel)?;
                if path.exists() {
                    return Ok(false);
                }
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|err| format!("建不了分段目录 {}：{err}", parent.display()))?;
                }
                std::fs::write(&path, bytes)
                    .map_err(|err| format!("写不进分段 {}：{err}", path.display()))?;
                Ok(true)
            }
            Transport::Webdav(target) => md_webdav::put_new(target, rel, bytes)
                .await
                .map_err(|err| webdav_error_text(&err)),
        }
    }

    /// 读一份分段。不存在返回 `Ok(None)`（404 / 文件不存在都是「还没有这段」）。
    pub async fn get(&self, rel: &str) -> Result<Option<Vec<u8>>, String> {
        match self {
            Transport::Folder(root) => {
                let path = join(root, rel)?;
                if !path.exists() {
                    return Ok(None);
                }
                std::fs::read(&path)
                    .map(Some)
                    .map_err(|err| format!("读不进分段 {}：{err}", path.display()))
            }
            Transport::Webdav(target) => match md_webdav::get(target, rel).await {
                Ok(outcome) => Ok(Some(outcome.bytes)),
                Err(WebdavError::NotFound) => Ok(None),
                Err(err) => Err(webdav_error_text(&err)),
            },
        }
    }

    /// 列 `rel` 目录下的直接子项名（设备目录 / 分段文件名，不含父路径）。
    ///
    /// 目录还不存在（首轮、还没有任何设备写过分段）返回空列表，不算错误。
    pub async fn list_children(&self, rel: &str) -> Result<Vec<String>, String> {
        match self {
            Transport::Folder(root) => {
                let dir = join(root, rel)?;
                if !dir.exists() {
                    return Ok(Vec::new());
                }
                let mut names = Vec::new();
                let entries = std::fs::read_dir(&dir)
                    .map_err(|err| format!("列不了目录 {}：{err}", dir.display()))?;
                for entry in entries {
                    let entry = entry.map_err(|err| format!("读目录项失败：{err}"))?;
                    if let Some(name) = entry.file_name().to_str() {
                        names.push(name.to_string());
                    }
                }
                Ok(names)
            }
            Transport::Webdav(target) => match md_webdav::list_children(target, rel).await {
                Ok(names) => Ok(names),
                Err(WebdavError::NotFound) => Ok(Vec::new()),
                Err(err) => Err(webdav_error_text(&err)),
            },
        }
    }
}

/// 把 `rel` 拼到本地根下，拒绝 `..` / 绝对路径（与 `md_webdav::url_for` 同一纪律）。
fn join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim().trim_start_matches('/');
    if rel.is_empty() {
        return Ok(root.to_path_buf());
    }
    let path = Path::new(rel);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::RootDir))
    {
        return Err(format!("远端相对路径不能包含 .. 或盘符：{rel}"));
    }
    Ok(root.join(path))
}

/// `WebdavError` → 人话（给 `report.errors`，与 `round_push::fail_text` 同风格）。
fn webdav_error_text(err: &WebdavError) -> String {
    match err {
        WebdavError::Auth => "云端：登录失败（应用密码不对）".to_string(),
        WebdavError::Forbidden => "云端：没有写权限".to_string(),
        WebdavError::RateLimited => "云端：请求太频繁，稍后自动重试".to_string(),
        WebdavError::Precondition => "云端：目标已存在".to_string(),
        WebdavError::NotFound => "云端：找不到目标".to_string(),
        WebdavError::Timeout => "云端：连接超时".to_string(),
        WebdavError::Network(message) => format!("云端：{message}"),
        WebdavError::Server(code) => format!("云端：服务端错误 {code}"),
    }
}
