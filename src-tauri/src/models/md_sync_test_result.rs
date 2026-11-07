//! 「测试连接」的结果结构（V0.11.16，设计 §4.4）。
//!
//! 从 `models/md_sync_cloud.rs` 搬出来：那个文件 295 行，贴到单文件 ≤300 行的门禁；
//! 而这两个结构只服务「测试连接」这一条命令，与云端配置/视图不是同一类东西。
//! `md_sync_cloud.rs` 里留了一行 `pub use`，外部路径（`models::md_sync_cloud::…`）
//! 一个字都不用改。
//!
//! ## 为什么 `steps` 是附加信息而不是替代品
//!
//! `ok` / `detail` 的语义**一个字没变**：老前端（手机端、浏览器 mock、任何没升级的
//! 壳）拿到的还是一句人话。`steps` 只回答「红在第几关」，没有它也不会读错。

use serde::Serialize;

/// 「测试连接」的结果。`ok = false` 时 `detail` 是**人话**（不是 `HTTP 403`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncTestResult {
    pub ok: bool,
    /// 全绿时是摘要句；失败时**就是失败那一关的原文**（不拼接、不改写）。
    pub detail: String,
    /// 只含**已经走过**的关（失败即停）。本地目录通道只有一个动作，所以是空 vec。
    #[serde(default)]
    pub steps: Vec<MdSyncTestStep>,
}

/// 一关的结论。
///
/// `key` 是**契约**（`"account"` / `"dir"` / `"write"`）：前端据此排顺序、取标签，
/// **不许解析文案**。标签（账号 / 目录 / 写入）是前端的文案，改标签不必改这里。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncTestStep {
    pub key: String,
    pub ok: bool,
    /// 这一关失败时的一句人话；`None` = 通过
    pub detail: Option<String>,
}
