//! 分析窗（insight）事件名常量（唯一出处）。
//!
//! ## 为什么在 `models/insight/` 而不是 `app/insight/`
//!
//! 事件名的 14 个 emit 点分布在 5 层：`app`（4）、`commands`（2）、`infra`（2）、
//! `services`（6）。`app/mod.rs` 的模块文档写着「禁止：被 `infra` 反向依赖（否则又成环）」，
//! 把常量放 `app/insight/` 会让 `infra` 与 `services` 全部反向依赖装配层 —— 那正是分层
//! 规则要拦住的方向。`models/insight` 是「纯类型 + 规则、出边 0」的叶子（见
//! `docs/refactor/patina-structural-merge.md` §2.2 B1），所有层都能依赖它。
//!
//! 前端镜像：`src/platform/runtime/insightEvents.ts`（同名同值；只收前端真的在 listen 的
//! 6 个，`POWER_*` 两个是 Rust 内部事件）。
//!
//! 归一前这 14 处都是以字符串字面量作为事件名 emit 的；`check-contract.mjs` 当时靠
//! 「路径属于 vendored 子树」豁免它们。路径前缀归一后失效，事件名必须有自己的常量。

/// 分析窗设置变更（`app/insight`、`commands/insight` 共 4 处 emit）。
pub const APP_SETTINGS_CHANGED: &str = "app-settings-changed";
/// 应用图标变更（数据层图标缓存回填后广播）。
pub const APP_ICON_CHANGED: &str = "app-icon-changed";
/// 当前活动窗口变更（跟踪运行时的快照推送）。
pub const ACTIVE_WINDOW_CHANGED: &str = "active-window-changed";
/// 跟踪数据变更（会话/网页活动落库后的旁路通知）。
pub const TRACKING_DATA_CHANGED: &str = "tracking-data-changed";
/// 主窗工具分区的跳转目标（`emit_to` 到 `patina` 窗）。
pub const MAIN_TOOLS_TARGET_CHANGED: &str = "main-tools-target-changed";
/// 迷你窗状态快照（`emit_to` 到 `mini` 窗）。
pub const MINI_WINDOW_STATE: &str = "mini-window-state";
/// 电源/会话生命周期事件（Rust 内部，前端不监听）。
pub const POWER_LIFECYCLE_CHANGED: &str = "power-lifecycle-changed";
/// 电源监听器就绪（Rust 内部，前端不监听）。
pub const POWER_WATCHER_READY: &str = "power-watcher-ready";
