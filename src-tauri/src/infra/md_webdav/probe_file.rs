//! 「测试连接」的**探针写法与收尾**（V0.11.16，设计 §4.1）。
//!
//! 为什么不写进 `mod.rs`：那个文件 286 行，塞完就贴到 300 行门禁；而 `delete` 只服务
//! 「清掉自己的探针」这一个场景，与 `get` / `put`（服务同步主路径）不是同一类动作。
//!
//! 文件名**不带点前缀**（主理人裁决）：部分服务端拒收隐藏文件，会把「能写」误判成
//! 「不能写」——一次假红比一次假绿更贵，用户会去改一个本来就对的配置。
//!
//! ## 已知且可接受的残留
//!
//! `client()` 会跟随重定向，而 reqwest 对 301/302/303 会把方法改成 GET——最坏情况是
//! 「以为删掉了、其实留下一个 0 字节探针文件」。PRD 已按「与本地目录模式完全一致」
//! 接受探针残留，不值得为一个清理动作再造一个 `Policy::none()` 的 Client。

use super::{WebdavError, WebdavTarget};

/// 探针文件名（**不是** `.timing-write-test`，理由见模块头）。
pub const PROBE_FILE: &str = "timing-write-test.txt";

/// 第 3 关：真写一次再删掉。`Ok` 只代表 **PUT 成功**；DELETE 失败不算失败。
///
/// 判据是「这个目录收不收我的文件」——`ensure_base_dir` 已经证明目录在，PUT 通过就
/// 证明能写。删不掉只是留一个可忽略的痕迹，不该把绿字改成红字。
pub async fn write_probe(target: &WebdavTarget) -> Result<(), WebdavError> {
    super::put(target, PROBE_FILE, b"timing", None).await?;
    delete_quietly(target).await;
    Ok(())
}

/// `DELETE` 一个远端文件。`404` 视为成功（已经不在那儿了）。
pub async fn delete(target: &WebdavTarget, rel: &str) -> Result<(), WebdavError> {
    let url = target.url_for(rel)?;
    let response = super::client()
        .delete(&url)
        .basic_auth(&target.user, Some(&target.password))
        .send()
        .await
        .map_err(super::map_reqwest)?;
    match super::fail_on_status(response.status()) {
        Err(WebdavError::NotFound) => Ok(()),
        other => other,
    }
}

/// DELETE 失败**只记日志**：不影响绿字。
async fn delete_quietly(target: &WebdavTarget) {
    if let Err(err) = delete(target, PROBE_FILE).await {
        crate::log_warn!("md cloud probe cleanup: {PROBE_FILE} fail={err:?}");
    }
}
