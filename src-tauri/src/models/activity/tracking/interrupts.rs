pub(crate) fn resolve_interrupted_session_end(
    session_start_time: i64,
    last_sample_ms: Option<i64>,
    now_ms: i64,
) -> i64 {
    // A heartbeat proves liveness, not foreground activity. Missing or impossible
    // sample times cannot justify extending an interrupted session through downtime.
    last_sample_ms
        .filter(|sample| *sample >= session_start_time && *sample <= now_ms)
        .unwrap_or(session_start_time)
}
