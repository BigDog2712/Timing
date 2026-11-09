use crate::models::insight::tools::{PomodoroStatus, PomodoroTaskAction, ToolPomodoroRun, ToolPomodoroTask};
use sqlx::{Pool, Row, Sqlite, Transaction};

pub(super) async fn notification_task(
    tx: &mut Transaction<'_, Sqlite>,
    id: i64,
) -> Result<ToolPomodoroTask, String> {
    let run = read_task(tx, id).await?;
    let (label, completed_groups): (String, i64) = sqlx::query_as(
        "SELECT COALESCE(t.label,''), COALESCE(c.completed_groups,0) FROM tool_pomodoro_runs r
         LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id
         LEFT JOIN tool_pomodoro_task_completions c ON c.run_id=r.id WHERE r.id=?",
    )
    .bind(id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(ToolPomodoroTask {
        label,
        completed_groups,
        run,
    })
}

pub(super) async fn complete_group(
    tx: &mut Transaction<'_, Sqlite>,
    run: &ToolPomodoroRun,
    now_ms: i64,
) -> Result<crate::models::insight::tools::CompletedPomodoroNotification, String> {
    sqlx::query("UPDATE tool_pomodoro_runs SET status='completed',phase_started_at=NULL,phase_paused_at=NULL,phase_remaining_ms=0,updated_at=? WHERE id=?")
        .bind(now_ms).bind(run.id).execute(&mut **tx).await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO tool_pomodoro_task_completions(run_id,completed_groups) VALUES(?,1)
        ON CONFLICT(run_id) DO UPDATE SET completed_groups=completed_groups+1",
    )
    .bind(run.id)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(crate::models::insight::tools::CompletedPomodoroNotification {
        task: notification_task(tx, run.id).await?,
        run_id: run.id,
        completed_phase: run.phase,
        next_phase: crate::models::insight::tools::PomodoroPhase::Focus,
        completed_focus_count: run.completed_focus_count,
    })
}

pub(super) async fn fetch_tasks(pool: &Pool<Sqlite>) -> Result<Vec<ToolPomodoroTask>, String> {
    let rows = sqlx::query("SELECT r.*, COALESCE(t.label, '') AS task_label, COALESCE(c.completed_groups, 0) AS completed_groups FROM tool_pomodoro_runs r
        LEFT JOIN tool_pomodoro_tasks t ON t.run_id = r.id
        LEFT JOIN tool_pomodoro_task_completions c ON c.run_id = r.id WHERE t.deleted_at IS NULL ORDER BY r.created_at, r.id")
        .fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| ToolPomodoroTask {
            label: row.get("task_label"),
            completed_groups: row.get("completed_groups"),
            run: super::read::map_pomodoro_row(row),
        })
        .collect())
}

async fn read_task(tx: &mut Transaction<'_, Sqlite>, id: i64) -> Result<ToolPomodoroRun, String> {
    let row = sqlx::query(
        "SELECT r.* FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id
        WHERE r.id=? AND t.deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "pomodoro task is unavailable".to_string())?;
    Ok(super::read::map_pomodoro_row(row))
}

async fn pause(
    tx: &mut Transaction<'_, Sqlite>,
    run: &ToolPomodoroRun,
    now_ms: i64,
) -> Result<(), String> {
    if run.status != PomodoroStatus::Running {
        return Ok(());
    }
    sqlx::query(
        "UPDATE tool_pomodoro_runs SET status='paused', phase_started_at=NULL, phase_paused_at=?,
        phase_remaining_ms=?, updated_at=? WHERE id=?",
    )
    .bind(now_ms)
    .bind(run.remaining_ms_at(now_ms))
    .bind(now_ms)
    .bind(run.id)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) async fn pause_active(
    tx: &mut Transaction<'_, Sqlite>,
    now_ms: i64,
) -> Result<(), String> {
    let rows = sqlx::query("SELECT * FROM tool_pomodoro_runs WHERE status='running'")
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    for row in rows {
        pause(tx, &super::read::map_pomodoro_row(row), now_ms).await?;
    }
    Ok(())
}

pub(crate) async fn recover_single_active(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query(
        "SELECT r.* FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id
        WHERE r.status='running' AND t.deleted_at IS NULL ORDER BY r.updated_at DESC,r.id DESC",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    for row in rows.into_iter().skip(1) {
        pause(&mut tx, &super::read::map_pomodoro_row(row), now_ms).await?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

pub(crate) async fn apply(
    pool: &Pool<Sqlite>,
    action: PomodoroTaskAction,
    now_ms: i64,
    date_key: &str,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    if let PomodoroTaskAction::StartNext {
        id,
        expected_updated_at,
    } = &action
    {
        let run = read_task(&mut tx, *id).await?;
        if run.updated_at != *expected_updated_at
            || !matches!(
                run.status,
                PomodoroStatus::Paused | PomodoroStatus::Completed
            )
        {
            return Err("pomodoro notification is stale".to_owned());
        }
    }
    match action {
        PomodoroTaskAction::Save {
            id,
            label,
            focus_ms,
            short_break_ms,
            long_break_ms,
            long_break_every,
        } => {
            if label.trim().chars().count() > 160
                || !(60_000..=10_800_000).contains(&focus_ms)
                || !(60_000..=3_600_000).contains(&short_break_ms)
                || !(60_000..=7_200_000).contains(&long_break_ms)
                || !(2..=12).contains(&long_break_every)
            {
                return Err("invalid pomodoro task configuration".into());
            }
            let id = if let Some(id) = id {
                let run = read_task(&mut tx, id).await?;
                if run.status == PomodoroStatus::Running {
                    return Err("pause pomodoro before editing".into());
                }
                if run.focus_ms != focus_ms
                    || run.short_break_ms != short_break_ms
                    || run.long_break_ms != long_break_ms
                    || run.long_break_every != long_break_every
                {
                    sqlx::query("UPDATE tool_pomodoro_runs SET phase='focus', status='idle', cycle_index=1, focus_ms=?, short_break_ms=?,
                    long_break_ms=?, long_break_every=?, phase_started_at=NULL, phase_paused_at=NULL, phase_remaining_ms=?, completed_focus_count=0, updated_at=? WHERE id=?")
                    .bind(focus_ms).bind(short_break_ms).bind(long_break_ms).bind(long_break_every).bind(focus_ms).bind(now_ms).bind(id)
                    .execute(&mut *tx).await.map_err(|e| e.to_string())?;
                }
                id
            } else {
                let created_at: i64 = sqlx::query_scalar(
                    "SELECT MAX(?, COALESCE(MAX(created_at)+1, ?)) FROM tool_pomodoro_runs",
                )
                .bind(now_ms)
                .bind(now_ms)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
                sqlx::query("INSERT INTO tool_pomodoro_runs(phase,status,cycle_index,focus_ms,short_break_ms,long_break_ms,long_break_every,
                    phase_started_at,phase_paused_at,phase_remaining_ms,completed_focus_count,created_at,updated_at)
                    VALUES('focus','idle',1,?,?,?,?,NULL,NULL,?,0,?,?)")
                    .bind(focus_ms).bind(short_break_ms).bind(long_break_ms).bind(long_break_every).bind(focus_ms).bind(created_at).bind(now_ms)
                    .execute(&mut *tx).await.map_err(|e| e.to_string())?.last_insert_rowid()
            };
            sqlx::query("INSERT INTO tool_pomodoro_tasks(run_id,label) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET label=excluded.label")
                .bind(id).bind(label.trim()).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
        PomodoroTaskAction::Resume { id } | PomodoroTaskAction::StartNext { id, .. } => {
            let run = read_task(&mut tx, id).await?;
            if run.status != PomodoroStatus::Running {
                super::free_focus::pause_active(&mut tx, now_ms).await?;
                let active=sqlx::query("SELECT r.* FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id WHERE r.status='running' AND t.deleted_at IS NULL")
                    .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
                for row in active {
                    pause(&mut tx, &super::read::map_pomodoro_row(row), now_ms).await?;
                }
                if run.status == PomodoroStatus::Completed {
                    sqlx::query("UPDATE tool_pomodoro_runs SET phase='focus',cycle_index=1,phase_remaining_ms=focus_ms WHERE id=?")
                        .bind(id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
                }
                sqlx::query("UPDATE tool_pomodoro_runs SET status='running',phase_started_at=?,phase_paused_at=NULL,updated_at=? WHERE id=?")
                    .bind(now_ms).bind(now_ms).bind(id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
            }
        }
        PomodoroTaskAction::Pause { id } => {
            let run = read_task(&mut tx, id).await?;
            pause(&mut tx, &run, now_ms).await?;
        }
        PomodoroTaskAction::Skip { id } => {
            let run = read_task(&mut tx, id).await?;
            super::advance_pomodoro_phase(&mut tx, run, date_key, now_ms, false, false).await?;
        }
        PomodoroTaskAction::Reset { id } => {
            read_task(&mut tx, id).await?;
            sqlx::query("UPDATE tool_pomodoro_runs SET phase='focus',status='idle',cycle_index=1,phase_started_at=NULL,phase_paused_at=NULL,
                phase_remaining_ms=focus_ms,completed_focus_count=0,updated_at=? WHERE id=?").bind(now_ms).bind(id)
                .execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
        PomodoroTaskAction::Delete { id } => {
            let run = read_task(&mut tx, id).await?;
            pause(&mut tx, &run, now_ms).await?;
            sqlx::query("INSERT INTO tool_pomodoro_tasks(run_id,label,deleted_at) VALUES(?,'',?) ON CONFLICT(run_id) DO UPDATE SET deleted_at=excluded.deleted_at")
                .bind(id).bind(now_ms).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "pomodoro_tasks_mod_tests.rs"]
mod tests;
