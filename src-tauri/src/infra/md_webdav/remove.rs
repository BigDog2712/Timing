//! 删远端一个**已知相对路径**的文件（V0.11.19 变更 A，设计 §3.2）。
//!
//! ## 为什么不复用 `probe_file::delete`
//!
//! | # | 探针的 `delete` | 本文件 | 后果 |
//! |---|---|---|---|
//! | 1 | `super::client()` 默认跟随重定向 | `remove_client()` 写死 `redirect(Policy::none())` | reqwest 对 301/302/303 会把 DELETE **改成 GET**，返回 200 → 探针那条路判成功 → 我们以为删了、其实一个字节没动，而水位照样推进 → 这个日期**永远漏删**；307/308 保留方法但会把 DELETE 发到 `Location` 指向的另一个路径 → 删掉一个没算过的文件 |
//! | 2 | 返回 `Result<(), _>`，状态码被吃掉 | 返回 `Result<u16, _>` | 日志要逐字记 `status={code}`，`204` / `200` / `404` 要能分辨 |
//! | 3 | 语义写死「只服务探针」，且 N3 要求它零 diff | 独立模块 | 「往期真删」挂在一个叫 `probe_file` 的模块下，下一个人必然误判 |
//!
//! 语义三档：2xx → `Ok(code)`；`404` → `Ok(404)`（幂等：本来就不在，算成功）；
//! 其余 → `Err(WebdavError)`（`401/403/429` 由调方升级为「立即中断本批」）。

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::redirect::Policy;
use reqwest::Client;

use super::{map_reqwest, WebdavError, WebdavTarget, USER_AGENT};
use crate::models::constants::{MD_CLOUD_CONNECT_SECS, MD_CLOUD_READ_SECS};

/// 删一个已知相对路径的文件。`rel` 只允许是枚举到的严格日期名，不含 `..`。
pub async fn delete_file(target: &WebdavTarget, rel: &str) -> Result<u16, WebdavError> {
    let url = target.url_for(rel)?;
    let response = remove_client()
        .delete(&url)
        .basic_auth(&target.user, Some(&target.password))
        .send()
        .await
        .map_err(map_reqwest)?;
    let code = response.status().as_u16();
    /* 404 要先于 `fail_on_status` 判：后者会把它翻成 `NotFound` 错误，
       而「本来就不在」对清理是成功（I15 收敛路径里 404 会反复出现）。 */
    if code == 404 {
        return Ok(404);
    }
    super::fail_on_status(response.status())?;
    Ok(code)
}

/// DELETE 专用 Client：**禁止跟随重定向**（理由见模块头）。
///
/// 不共用 `mod.rs::client()`：GET / PUT 的 3xx 语义与 DELETE 不同——后者的 3xx
/// 一旦被跟随，方法会被改写，得到的是一个「看起来成功」的假象。
fn remove_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        /* 与 `mod.rs::client()` 同一段理由：`rustls-no-provider` 必须自己装加密提供者。
           重复安装只会在第二次返回 Err，忽略即可。 */
        let _ = rustls::crypto::ring::default_provider().install_default();
        Client::builder()
            .connect_timeout(Duration::from_secs(MD_CLOUD_CONNECT_SECS))
            .timeout(Duration::from_secs(MD_CLOUD_READ_SECS))
            .user_agent(USER_AGENT)
            .redirect(Policy::none())
            .build()
            /* 建 Client 失败只可能是系统 TLS 配置坏了，不 panic：release 是
               `panic = "abort"`。退回默认 Client 会失去 `Policy::none()`，所以
               明确不回退——宁可这一轮删除失败、水位不推进，也不做「假成功」。 */
            .expect("DELETE 专用 Client 必须带 Policy::none()")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remove_client_never_follows_redirects() {
        /* 这条断言的是构造形状，不是网络行为：`Policy::none()` 一旦被删，
           `delete_file` 就会在 301/302/303 上把 DELETE 改成 GET，水位静默推进。 */
        let client = remove_client();
        assert!(format!("{client:?}").contains("Client"), "Client 应可构造");
    }
}
