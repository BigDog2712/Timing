//! 数据访问层：仅 SQL + 行映射，不含业务规则。

pub mod item;
/* 写入口判据（`insert` 必须自己写 `device_id`，否则 uid 永远发不出来）。
   拆出来是因为 `item.rs` 正文贴近单文件 300 行门禁，与 `timer_ops_tests` 同一套挂法。 */
#[cfg(test)]
mod item_tests;
/* [0.13.x] 事项 ↔ 应用绑定：幂等绑定 / 解绑 / 正反两向查询。 */
pub mod item_app;
pub mod md_cloud_pending;
pub mod md_sync;
pub mod md_sync_todo;
pub mod note;
pub mod record;
pub(crate) mod record_revision;
pub mod record_session;
/* [0.13.x] 结束 / 跨天拆分段落库： 在此 re-export。 */
pub mod record_session_split;
/* 分段换事项（事务内版本供 timer::switch 与事件同事务）。 */
pub(crate) mod record_session_switch;
pub mod reminder;
pub mod settings;
pub mod todo;
/* [0.13.x] 计时事件：timer_ops 追加 / 折叠 / 物化。

   `allow(dead_code)` 的摘除条件：`services::timer` 的 start/pause/resume/stop 接上这里
   之后立刻删（届时事件流成为计时状态的第二写入方，不再有「无人调用的仓储」）。 */
#[allow(dead_code)]
pub mod timer_ops;
/* [S3] 计时事件的**事务内**写入：状态行与事件流必须一起落，否则「本机暂停了、对端还在跑」
   而两端都不报错。实现从 `timer_ops.rs` 搬过来（那个文件压在 300 行上）。 */
pub(crate) mod timer_ops_event;
#[cfg(test)]
mod timer_ops_tests;
pub mod todo_nudge;
