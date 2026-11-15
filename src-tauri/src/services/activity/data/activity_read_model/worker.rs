//! 活动读模型的后台维护线程（从 `activity_read_model/mod.rs` 搬出来）。
//!
//! 搬的理由只有一条：`mod.rs` 正好压在 `check:size` 的冻结线上，而 T03/T04 要往里加
//! `mod daily;` / `mod facts;` / 日级 DTO。这里的逻辑与「读模型对外是什么」无关，
//! 只是"多久唤醒一次、空闲怎么退避"，所以整块搬走、`mod.rs` 里 `pub(crate) use` 回挂
//! （调用点 `app::activity::runtime` 与本文件的用例都走原路径，零改动）。

use super::{maintain_once, now_ms};
use crate::services::activity::data::sqlite_pool::{optimize_query_statistics, wait_for_sqlite_pool};
use sqlx::{Pool, Sqlite};
use std::sync::{Arc, Weak};
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::{sleep, Duration};

const WORKER_ACTIVE_DELAY: Duration = Duration::from_millis(50);
const WORKER_IDLE_DELAY: Duration = Duration::from_secs(3);
const MAX_IDLE_DELAY: Duration = Duration::from_secs(12);
const STATISTICS_RECHECK: Duration = Duration::from_secs(3600);

#[derive(Default)]
pub(crate) struct ReadModelWake(tokio::sync::Notify);

pub(crate) fn wake_worker<R: Runtime>(app: &AppHandle<R>) {
    if let Some(wake) = app.try_state::<ReadModelWake>() {
        wake.0.notify_one();
    }
}

pub fn spawn_background_worker<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let wake = app.state::<ReadModelWake>();
        let mut schedule = MaintenanceSchedule::default();
        let mut idle_delay = WORKER_IDLE_DELAY;
        loop {
            let pool = wait_for_sqlite_pool(&app).await;
            let result = match pool {
                Ok(pool) => {
                    let result = schedule.tick(&pool).await;
                    if result.is_err() {
                        let _ = record_maintenance_failure(&pool).await;
                    }
                    result
                }
                Err(error) => Err(error),
            };
            match result {
                Ok(true) => {
                    idle_delay = WORKER_IDLE_DELAY;
                    sleep(WORKER_ACTIVE_DELAY).await;
                }
                Ok(false) => {
                    tokio::select! {
                        _ = sleep(idle_delay) => idle_delay = (idle_delay * 2).min(MAX_IDLE_DELAY),
                        _ = wake.0.notified() => idle_delay = WORKER_IDLE_DELAY,
                    }
                }
                Err(error) => {
                    idle_delay = WORKER_IDLE_DELAY;
                    crate::log_warn!("background maintenance failed: {error}");
                    sleep(WORKER_IDLE_DELAY).await;
                }
            }
        }
    });
}

#[derive(Default)]
pub(crate) struct MaintenanceSchedule {
    pool_options: Weak<sqlx::sqlite::SqliteConnectOptions>,
    // 三个字段是 `pub(crate)` 只为一件事：`mod_mod_tests` 断言「优化失败不算读模型失败」
    // 要看 `pending_statistics` / `retry_after`。搬文件不该连私有性一起改语义。
    pub(crate) pending_statistics: bool,
    pub(crate) next_statistics: Option<Instant>,
    pub(crate) retry_after: Option<Instant>,
}

impl MaintenanceSchedule {
    pub(crate) async fn tick(&mut self, pool: &Pool<Sqlite>) -> Result<bool, String> {
        let identity = Arc::downgrade(&pool.connect_options());
        if !self.pool_options.ptr_eq(&identity) {
            *self = Self {
                pool_options: identity,
                ..Default::default()
            };
        }
        let did_work = maintain_once(pool).await?;
        if did_work {
            self.pending_statistics = true;
            return Ok(true);
        }
        let now = Instant::now();
        if self.retry_after.is_some_and(|retry| now < retry)
            || (!self.pending_statistics && self.next_statistics.is_some_and(|due| now < due))
        {
            return Ok(false);
        }
        match optimize_query_statistics(pool).await {
            Ok(()) => {
                self.pending_statistics = false;
                self.next_statistics = Some(now + STATISTICS_RECHECK);
                self.retry_after = None;
            }
            Err(error) => {
                self.retry_after = Some(now + Duration::from_secs(60));
                crate::log_warn!("query statistics optimization deferred: {error}");
            }
        }
        Ok(false)
    }
}

pub(crate) async fn record_maintenance_failure(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        "UPDATE read_model_state
         SET state = CASE WHEN state = 'building' THEN 'failed' ELSE state END,
             last_error_code = 'maintenance_failed', updated_at_ms = ?",
    )
    .bind(now_ms())
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| format!("failed to record read model maintenance failure: {error}"))
}
