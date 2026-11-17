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
//!
//! ## 本地目录通路为什么不能直接 `fs::write`（2026-11-16，评审 P1-1）
//!
//! 同步盘的另一端**随时可能在读**：`fs::write` 先创建/截断最终路径再往里灌字节，
//! 中间那一刻对方读到的就是「0 字节」或「前 n 行」。而 JSONL 的前 n 行是合法数据，
//! 于是残段会被当成完整分段应用、游标推进，剩下的行永久丢失。
//!
//! 所以这里一律「临时文件 → 写完 flush 到盘 → 原子发布」：读者要么看不到这个文件，
//! 要么看到完整的一份。发布用 `hard_link`（POSIX/`NTFS` 上都是原子且**不覆盖**，
//! 正好等于 `put_if_absent` 的语义）；文件系统不支持硬链接时退回 `rename`
//! （Windows 上目标已存在会失败 = 仍然不覆盖；POSIX 上会覆盖，但那是「两台设备抢同一个
//! seq」的既有冲突，`push` 的逐字节回读校验会把它挡在游标之前）。

use std::io::Write;
use std::path::{Component, Path, PathBuf};

use crate::infra::md_webdav::{self, WebdavError, WebdavTarget};

/// 临时文件名的递增后缀：同一进程里两轮并发写同一个目录时不会互相踩。
static TMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/* 测试注入点：为真时「临时文件写完、还没发布」这一步直接失败。
 *
 * 这条钩子存在的理由：**「读者永远看不到半份文件」在没有故障注入时无法被判据覆盖**。
 * 置位后 `publish_atomic` 走的是「内容已经完整落在临时文件里、但没发布」这个状态，正是
 * 进程被杀那一刻的等价物；判据断言最终路径**不存在**（而不是「存在但是空的」）。有人
 * 把原子发布换回 `fs::write` 时它会立刻红（那个瞬间文件已存在）。
 *
 * **线程局部**，不是全局：并行用例各自有一个 push，全局标记会被邻居抢走 —— 那会让
 * 「注入了故障的用例」和「被误伤的用例」同时变色，方向都看不出来。 */
#[cfg(test)]
thread_local! {
    static FAIL_BEFORE_PUBLISH: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_AFTER_PUT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// 置位本线程的注入点（见上）。
#[cfg(test)]
pub(crate) fn fail_before_publish() {
    FAIL_BEFORE_PUBLISH.with(|flag| flag.set(true));
}

#[cfg(test)]
pub(crate) fn fail_after_put() {
    FAIL_AFTER_PUT.with(|flag| flag.set(true));
}

#[cfg(test)]
pub(crate) fn consume_fail_after_put() -> bool {
    FAIL_AFTER_PUT.with(|flag| flag.replace(false))
}

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
                publish_atomic(&path, bytes)
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

/// 先写临时文件、flush 到盘，再原子发布成最终路径。返回「是否真的写进去了」。
///
/// 与 [`Transport::Folder::put_if_absent`] 的分工：那个负责「已存在就别动」，这个负责
/// 「要么看不见、要么看得见完整的一份」。两者合起来才是「不可变分段」。
fn publish_atomic(path: &Path, bytes: &[u8]) -> Result<bool, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("分段路径没有父目录：{}", path.display()))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "segment".to_string());
    let serial = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    /* 名字以 `.` 开头、以 `.tmp` 结尾：同步盘的「忽略临时文件」规则（`~$` / `.tmp` /
       隐藏文件）大概率能盖住它，即使进程被强杀留下残骸也不会被当成一个分段。 */
    let tmp = parent.join(format!(".{name}.{}-{serial}.tmp", std::process::id()));

    {
        let mut file = std::fs::File::create(&tmp)
            .map_err(|err| format!("建不了临时分段 {}：{err}", tmp.display()))?;
        file.write_all(bytes)
            .map_err(|err| format!("写不进临时分段 {}：{err}", tmp.display()))?;
        /* flush 到盘再发布：只 flush 到内核时，断电后可能留下一个「名字有了、内容是空的」
           文件 —— 那正是这次要消灭的形态。 */
        file.sync_all()
            .map_err(|err| format!("刷不进盘 {}：{err}", tmp.display()))?;
    }

    #[cfg(test)]
    if FAIL_BEFORE_PUBLISH.with(|flag| flag.replace(false)) {
        let _ = std::fs::remove_file(&tmp);
        return Err("injected: 临时文件写完、发布之前失败".to_string());
    }

    let published = match std::fs::hard_link(&tmp, path) {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        /* 硬链接不被支持（FAT32、部分 SMB / 网盘挂载）→ 退回 rename。 */
        Err(_) => match std::fs::rename(&tmp, path) {
            Ok(()) => Ok(true),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(err) => Err(format!("发布分段失败 {}：{err}", path.display())),
        },
    };
    /* 硬链接成功时 tmp 还在（两份名字指向同一份内容），失败时也可能留下残骸：
       无论成败都清一次，清不掉也不影响结果。 */
    let _ = std::fs::remove_file(&tmp);
    published
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
        WebdavError::TooLarge => "云端：响应超过安全大小上限".to_string(),
        WebdavError::Forbidden => "云端：没有写权限".to_string(),
        WebdavError::RateLimited => "云端：请求太频繁，稍后自动重试".to_string(),
        WebdavError::Precondition => "云端：目标已存在".to_string(),
        WebdavError::NotFound => "云端：找不到目标".to_string(),
        WebdavError::Timeout => "云端：连接超时".to_string(),
        WebdavError::Network(message) => format!("云端：{message}"),
        WebdavError::Server(code) => format!("云端：服务端错误 {code}"),
    }
}
