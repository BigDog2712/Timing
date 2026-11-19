import { invoke } from "@tauri-apps/api/core";
import {
  isFiniteNumber as isNumber,
  isStringArray,
} from "../../shared/lib/runtimeTypeGuards.ts";
import type {
  RawIconNegativeCacheStats,
  RawProcessDetailsCacheStats,
  RawResourceDiagnosticsSnapshot,
  RawToolAlertStats,
  RawWebActivityBridgeRuntime,
  RawWebActivityBridgeStats,
  RawWindowsProcessResourceSnapshot,
  WebActivityBridgeErrorCategory,
  WebActivityBridgeRuntimeStatus,
} from "./resourceDiagnosticsRuntimeGatewayTypes.ts";

export interface ResourceDiagnosticsSnapshot {
  webviewWindowCount: number;
  webviewWindowLabels: string[];
  processResources: {
    handleCount: number;
    threadCount: number;
    workingSetBytes: number;
    privateUsageBytes: number;
  };
  processDetailsCache: {
    entries: number;
    positiveEntries: number;
    negativeEntries: number;
  };
  iconResultCache: {
    entries: number;
    positiveEntries: number;
    negativeEntries: number;
  };
  iconNegativeCache: {
    entries: number;
    limit: number;
    ttlMs: number;
    oldestAgeMs: number | null;
  };
  toolAlerts: {
    entries: number;
    limit: number;
  };
  webActivityBridge: {
    activeClients: number;
    activeClientLimit: number;
    rejectedClients: number;
    timedOutClients: number;
    requestTimeoutMs: number;
    runtime: {
      status: WebActivityBridgeRuntimeStatus;
      port: number | null;
      lastErrorCategory: WebActivityBridgeErrorCategory | null;
      retryCount: number;
      nextRetryAtMs: number | null;
    };
  };
}

declare global {
  interface Window {
    __TIME_TRACKER_RESOURCE_DIAGNOSTICS__?: () => Promise<ResourceDiagnosticsSnapshot>;
  }
}

function isRawProcessResources(value: unknown): value is RawWindowsProcessResourceSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.handle_count)
    && isNumber(record.thread_count)
    && isNumber(record.working_set_bytes)
    && isNumber(record.private_usage_bytes);
}

function isRawCacheStats(value: unknown): value is RawProcessDetailsCacheStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.entries)
    && isNumber(record.positive_entries)
    && isNumber(record.negative_entries);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isRawLimitStats(value: unknown): value is RawToolAlertStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.entries)
    && isNumber(record.limit);
}

function isRawIconNegativeCacheStats(value: unknown): value is RawIconNegativeCacheStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.entries)
    && isNumber(record.limit)
    && isNumber(record.ttl_ms)
    && isNullableNumber(record.oldest_age_ms);
}

function isRawWebActivityBridgeStats(value: unknown): value is RawWebActivityBridgeStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.active_clients)
    && isNumber(record.active_client_limit)
    && isNumber(record.rejected_clients)
    && isNumber(record.timed_out_clients)
    && isNumber(record.request_timeout_ms)
    && isRawWebActivityBridgeRuntime(record.runtime);
}

function isRawWebActivityBridgeRuntime(value: unknown): value is RawWebActivityBridgeRuntime {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const statuses: WebActivityBridgeRuntimeStatus[] = [
    "disabled",
    "starting",
    "listening",
    "retry-wait",
    "failed-terminal",
    "stopping",
  ];
  const errorCategories: WebActivityBridgeErrorCategory[] = [
    "address-in-use",
    "address-unavailable",
    "permission-denied",
    "invalid-input",
    "resource-exhausted",
    "interrupted",
    "other",
  ];
  return statuses.includes(record.status as WebActivityBridgeRuntimeStatus)
    && isNullableNumber(record.port)
    && (
      record.last_error_category === null
      || errorCategories.includes(record.last_error_category as WebActivityBridgeErrorCategory)
    )
    && isNumber(record.retry_count)
    && isNullableNumber(record.next_retry_at_ms);
}

function isRawResourceDiagnostics(value: unknown): value is RawResourceDiagnosticsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.webview_window_count)
    && isStringArray(record.webview_window_labels)
    && isRawProcessResources(record.process_resources)
    && isRawCacheStats(record.process_details_cache)
    && isRawCacheStats(record.icon_result_cache)
    && isRawIconNegativeCacheStats(record.icon_negative_cache)
    && isRawLimitStats(record.tool_alerts)
    && isRawWebActivityBridgeStats(record.web_activity_bridge);
}

function mapRawCacheStats(raw: RawProcessDetailsCacheStats) {
  return {
    entries: raw.entries,
    positiveEntries: raw.positive_entries,
    negativeEntries: raw.negative_entries,
  };
}

function mapRawResourceDiagnostics(raw: RawResourceDiagnosticsSnapshot): ResourceDiagnosticsSnapshot {
  return {
    webviewWindowCount: raw.webview_window_count,
    webviewWindowLabels: raw.webview_window_labels,
    processResources: {
      handleCount: raw.process_resources.handle_count,
      threadCount: raw.process_resources.thread_count,
      workingSetBytes: raw.process_resources.working_set_bytes,
      privateUsageBytes: raw.process_resources.private_usage_bytes,
    },
    processDetailsCache: mapRawCacheStats(raw.process_details_cache),
    iconResultCache: mapRawCacheStats(raw.icon_result_cache),
    iconNegativeCache: {
      entries: raw.icon_negative_cache.entries,
      limit: raw.icon_negative_cache.limit,
      ttlMs: raw.icon_negative_cache.ttl_ms,
      oldestAgeMs: raw.icon_negative_cache.oldest_age_ms,
    },
    toolAlerts: {
      entries: raw.tool_alerts.entries,
      limit: raw.tool_alerts.limit,
    },
    webActivityBridge: {
      activeClients: raw.web_activity_bridge.active_clients,
      activeClientLimit: raw.web_activity_bridge.active_client_limit,
      rejectedClients: raw.web_activity_bridge.rejected_clients,
      timedOutClients: raw.web_activity_bridge.timed_out_clients,
      requestTimeoutMs: raw.web_activity_bridge.request_timeout_ms,
      runtime: {
        status: raw.web_activity_bridge.runtime.status,
        port: raw.web_activity_bridge.runtime.port,
        lastErrorCategory: raw.web_activity_bridge.runtime.last_error_category,
        retryCount: raw.web_activity_bridge.runtime.retry_count,
        nextRetryAtMs: raw.web_activity_bridge.runtime.next_retry_at_ms,
      },
    },
  };
}

export async function loadResourceDiagnostics(): Promise<ResourceDiagnosticsSnapshot> {
  const payload = await invoke<unknown>("cmd_get_resource_diagnostics");
  if (!isRawResourceDiagnostics(payload)) {
    throw new Error("Invalid resource diagnostics payload");
  }

  return mapRawResourceDiagnostics(payload);
}

export function installDevelopmentResourceDiagnostics(
  loader: () => Promise<ResourceDiagnosticsSnapshot> = loadResourceDiagnostics,
) {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }

  window.__TIME_TRACKER_RESOURCE_DIAGNOSTICS__ = loader;
}
