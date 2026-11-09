use crate::models::insight::tools::{
    CompletedPomodoroNotification, PomodoroPhase, PomodoroStatus, ToolPomodoroRun,
    ToolRuntimeSettings,
};
use sqlx::{Pool, Sqlite, Transaction};

#[cfg(test)]
mod activity_extensions_tests;
mod activity_reminders;
#[cfg(test)]
mod activity_unique_target_tests;
mod backup_restore;
pub(crate) mod focus_history;
pub(crate) mod free_focus;
pub(crate) mod notification_preferences;
pub(crate) mod pomodoro_tasks;
mod read;
pub(crate) mod timed_reminders;

pub use activity_reminders::{
    create_activity_reminder_rule, disable_activity_reminder_rule, extend_activity_reminder,
    fire_due_activity_reminders, merge_activity_reminder_rules, set_activity_reminder_enabled,
    update_activity_reminder_limit,
};
pub(crate) use read::fetch_all_activity_reminder_rules;
pub use read::fetch_tools_snapshot;

pub use backup_restore::{
    fetch_all_daily_stats_for_backup, fetch_all_pomodoro_runs_for_backup,
    fetch_all_reminders_for_backup, insert_missing_for_restore,
};

use read::{fetch_latest_pomodoro, fetch_pomodoro_by_id};

pub async fn load_tool_runtime_settings(
    _pool: &Pool<Sqlite>,
) -> Result<ToolRuntimeSettings, sqlx::Error> {
    Ok(ToolRuntimeSettings::default())
}

pub async fn start_pomodoro(
    pool: &Pool<Sqlite>,
    focus_ms: i64,
    short_break_ms: i64,
    long_break_ms: i64,
    long_break_every: i64,
    now_ms: i64,
) -> Result<ToolPomodoroRun, String> {
    let focus_ms = focus_ms.max(1_000);
    let short_break_ms = short_break_ms.max(1_000);
    let long_break_ms = long_break_ms.max(1_000);
    let long_break_every = long_break_every.clamp(2, 12);
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    free_focus::pause_active(&mut tx, now_ms).await?;
    sqlx::query("UPDATE tool_pomodoro_runs SET status='paused', phase_remaining_ms=MAX(0,
        COALESCE(phase_remaining_ms, CASE phase WHEN 'focus' THEN focus_ms WHEN 'short_break' THEN short_break_ms ELSE long_break_ms END)
        - MAX(0, ? - COALESCE(phase_started_at, ?))), phase_started_at=NULL, phase_paused_at=?, updated_at=? WHERE status='running'")
        .bind(now_ms).bind(now_ms).bind(now_ms).bind(now_ms).execute(&mut *tx).await.map_err(|error|error.to_string())?;
    let result = sqlx::query(
        "INSERT INTO tool_pomodoro_runs (
            phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms,
            long_break_every, phase_started_at, phase_paused_at, phase_remaining_ms,
            completed_focus_count, created_at, updated_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)",
    )
    .bind(PomodoroPhase::Focus.as_str())
    .bind(PomodoroStatus::Running.as_str())
    .bind(focus_ms)
    .bind(short_break_ms)
    .bind(long_break_ms)
    .bind(long_break_every)
    .bind(now_ms)
    .bind(focus_ms)
    .bind(now_ms)
    .bind(now_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to start pomodoro: {error}"))?;
    sqlx::query("INSERT INTO tool_pomodoro_tasks(run_id,label) VALUES(?,'')")
        .bind(result.last_insert_rowid())
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    fetch_pomodoro_by_id(pool, result.last_insert_rowid()).await
}

pub async fn pause_pomodoro(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(run) = fetch_latest_pomodoro(pool).await? else {
        return Ok(());
    };
    if run.status != PomodoroStatus::Running {
        return Ok(());
    }

    let remaining_ms = run.remaining_ms_at(now_ms);
    sqlx::query(
        "UPDATE tool_pomodoro_runs
         SET status = ?,
             phase_started_at = NULL,
             phase_paused_at = ?,
             phase_remaining_ms = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(PomodoroStatus::Paused.as_str())
    .bind(now_ms)
    .bind(remaining_ms)
    .bind(now_ms)
    .bind(run.id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to pause pomodoro: {error}"))?;
    Ok(())
}

pub async fn resume_pomodoro(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(run) = fetch_latest_pomodoro(pool).await? else {
        return Ok(());
    };
    if !matches!(
        run.status,
        PomodoroStatus::Paused | PomodoroStatus::Completed
    ) {
        return Ok(());
    }
    pomodoro_tasks::apply(
        pool,
        crate::models::insight::tools::PomodoroTaskAction::Resume { id: run.id },
        now_ms,
        "",
    )
    .await
}

pub async fn skip_pomodoro_phase(
    pool: &Pool<Sqlite>,
    date_key: &str,
    now_ms: i64,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start pomodoro transaction: {error}"))?;
    let Some(run) = fetch_latest_pomodoro(&mut *tx).await? else {
        return Ok(None);
    };
    let outcome = advance_pomodoro_phase(&mut tx, run, date_key, now_ms, false, false).await?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit pomodoro transaction: {error}"))?;
    Ok(outcome)
}

pub async fn complete_due_pomodoro_phase(
    tx: &mut Transaction<'_, Sqlite>,
    date_key: &str,
    now_ms: i64,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    let Some(run) = fetch_latest_pomodoro(&mut **tx).await? else {
        return Ok(None);
    };
    if !run.is_phase_due(now_ms) {
        return Ok(None);
    }

    if run.phase == PomodoroPhase::LongBreak {
        return pomodoro_tasks::complete_group(tx, &run, now_ms)
            .await
            .map(Some);
    }
    advance_pomodoro_phase(tx, run, date_key, now_ms, true, false).await
}

async fn advance_pomodoro_phase(
    tx: &mut Transaction<'_, Sqlite>,
    run: ToolPomodoroRun,
    date_key: &str,
    now_ms: i64,
    count_focus_completion: bool,
    start_next_phase: bool,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    if run.status == PomodoroStatus::Idle || run.status == PomodoroStatus::Completed {
        return Ok(None);
    }

    let (next_phase, next_cycle_index, next_completed_focus_count) =
        if run.phase == PomodoroPhase::Focus && !count_focus_completion {
            let phase = if (run.completed_focus_count + 1) % run.long_break_every.max(1) == 0 {
                PomodoroPhase::LongBreak
            } else {
                PomodoroPhase::ShortBreak
            };
            let cycle_index = if phase == PomodoroPhase::LongBreak {
                run.long_break_every
            } else {
                (run.completed_focus_count + 1) % run.long_break_every.max(1)
            };
            (phase, cycle_index.max(1), run.completed_focus_count)
        } else {
            run.next_phase_after_completion()
        };
    let next_remaining_ms = match next_phase {
        PomodoroPhase::Focus => run.focus_ms,
        PomodoroPhase::ShortBreak => run.short_break_ms,
        PomodoroPhase::LongBreak => run.long_break_ms,
    };
    let next_status = if start_next_phase {
        PomodoroStatus::Running
    } else {
        PomodoroStatus::Paused
    };
    let next_started_at = (next_status == PomodoroStatus::Running).then_some(now_ms);
    let next_paused_at = (next_status == PomodoroStatus::Paused).then_some(now_ms);

    sqlx::query(
        "UPDATE tool_pomodoro_runs
         SET phase = ?,
             status = ?,
             cycle_index = ?,
             phase_started_at = ?,
             phase_paused_at = ?,
             phase_remaining_ms = ?,
             completed_focus_count = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(next_phase.as_str())
    .bind(next_status.as_str())
    .bind(next_cycle_index)
    .bind(next_started_at)
    .bind(next_paused_at)
    .bind(next_remaining_ms)
    .bind(next_completed_focus_count)
    .bind(now_ms)
    .bind(run.id)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to advance pomodoro phase: {error}"))?;

    let counted_focus = count_focus_completion && run.phase == PomodoroPhase::Focus;
    if counted_focus {
        increment_daily_pomodoro_stat_tx(tx, date_key, now_ms).await?;
    }

    Ok(Some(CompletedPomodoroNotification {
        task: pomodoro_tasks::notification_task(tx, run.id).await?,
        run_id: run.id,
        completed_phase: run.phase,
        next_phase,
        completed_focus_count: next_completed_focus_count,
    }))
}

pub async fn reset_pomodoro(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(run) = fetch_latest_pomodoro(pool).await? else {
        return Ok(());
    };

    sqlx::query(
        "UPDATE tool_pomodoro_runs
         SET phase = ?,
             status = ?,
             cycle_index = 1,
             phase_started_at = NULL,
             phase_paused_at = NULL,
             phase_remaining_ms = focus_ms,
             completed_focus_count = 0,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(PomodoroPhase::Focus.as_str())
    .bind(PomodoroStatus::Idle.as_str())
    .bind(now_ms)
    .bind(run.id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to reset pomodoro: {error}"))?;
    Ok(())
}

async fn increment_daily_pomodoro_stat_tx(
    tx: &mut Transaction<'_, Sqlite>,
    date_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO tool_daily_stats (date_key, completed_pomodoros, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(date_key) DO UPDATE SET
             completed_pomodoros = completed_pomodoros + 1,
             updated_at = excluded.updated_at",
    )
    .bind(date_key)
    .bind(now_ms)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to update pomodoro daily stats: {error}"))?;
    Ok(())
}

#[cfg(test)]
#[path = "tools_mod_tests.rs"]
mod tests;
