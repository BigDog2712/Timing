//! 时钟：墙钟毫秒（UTC）。计时状态机以墙钟为持久化口径（见 timer service 注释）。

/// 当前 UTC epoch 毫秒。
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
