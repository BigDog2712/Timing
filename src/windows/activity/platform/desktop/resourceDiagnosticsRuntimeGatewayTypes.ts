export interface RawWindowsProcessResourceSnapshot {
  handle_count: number;
  thread_count: number;
  working_set_bytes: number;
  private_usage_bytes: number;
}

export interface RawProcessDetailsCacheStats {
  entries: number;
  positive_entries: number;
  negative_entries: number;
}

export interface RawIconResultCacheStats {
  entries: number;
  positive_entries: number;
  negative_entries: number;
}

export interface RawIconNegativeCacheStats {
  entries: number;
  limit: number;
  ttl_ms: number;
  oldest_age_ms: number | null;
}

export interface RawToolAlertStats {
  entries: number;
  limit: number;
}

export type WebActivityBridgeRuntimeStatus =
  | "disabled"
  | "starting"
  | "listening"
  | "retry-wait"
  | "failed-terminal"
  | "stopping";

export type WebActivityBridgeErrorCategory =
  | "address-in-use"
  | "address-unavailable"
  | "permission-denied"
  | "invalid-input"
  | "resource-exhausted"
  | "interrupted"
  | "other";

export interface RawWebActivityBridgeRuntime {
  status: WebActivityBridgeRuntimeStatus;
  port: number | null;
  last_error_category: WebActivityBridgeErrorCategory | null;
  retry_count: number;
  next_retry_at_ms: number | null;
}

export interface RawWebActivityBridgeStats {
  active_clients: number;
  active_client_limit: number;
  rejected_clients: number;
  timed_out_clients: number;
  request_timeout_ms: number;
  runtime: RawWebActivityBridgeRuntime;
}

export interface RawResourceDiagnosticsSnapshot {
  webview_window_count: number;
  webview_window_labels: string[];
  process_resources: RawWindowsProcessResourceSnapshot;
  process_details_cache: RawProcessDetailsCacheStats;
  icon_result_cache: RawIconResultCacheStats;
  icon_negative_cache: RawIconNegativeCacheStats;
  tool_alerts: RawToolAlertStats;
  web_activity_bridge: RawWebActivityBridgeStats;
}
