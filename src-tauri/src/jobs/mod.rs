//! 常驻调度层（jobs）。
//!
//! 这一层是**唯一允许「定时触发业务动作」的地方**，职责边界：
//! - 可以依赖 `services`（动作）、`app::events`（广播）、`infra`（平台能力）；
//! - **不得直接依赖 `repositories`**：一切状态变更必须经 service，保证校验与事件不旁路。
//!
//! 之前这些 spawn 函数散在 `infra/` 里，导致 `infra` 反向依赖 `services`（模块级环），
//! `infra` 也就无法再作为「可整体替换的平台叶子」。搬到本层后，依赖方向变成单向：
//! `platform → infra → services → app/jobs`。

pub mod countdown;
pub mod flusher;
pub mod md_sync;
pub mod monitor;
pub mod nudge;
pub mod reminder;
