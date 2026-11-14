//! 数据访问层：仅 SQL + 行映射，不含业务规则。

pub mod item;
/* [0.13.x] 事项 ↔ 应用绑定：幂等绑定 / 解绑 / 正反两向查询。 */
pub mod item_app;
pub mod md_cloud_pending;
pub mod md_sync;
pub mod md_sync_todo;
pub mod note;
pub mod record;
pub mod record_session;
/* [0.13.x] 结束 / 跨天拆分段落库： 在此 re-export。 */
pub mod record_session_split;
pub mod reminder;
pub mod settings;
pub mod todo;
/* [0.13.x] 计时事件：timer_ops 追加 / 折叠 / 物化。

   `allow(dead_code)` 的摘除条件：`services::timer` 的 start/pause/resume/stop 接上这里
   之后立刻删（届时事件流成为计时状态的第二写入方，不再有「无人调用的仓储」）。 */
#[allow(dead_code)]
pub mod timer_ops;
#[cfg(test)]
mod timer_ops_tests;
pub mod todo_nudge;
