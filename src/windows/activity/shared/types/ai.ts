/**
 * 分析窗侧 AI 的形状（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 与宿主 `src/windows/timing/types/domain/ai.ts`（以及 Rust `models/ai.rs`）逐字对齐。
 * 两窗各存一份是 L9 的代价：分析窗不能 import 主窗目录，靠字段名与后端契约保持一致。
 */
export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  dailyEnabled: boolean;
  itemTagsEnabled: boolean;
  appTagsEnabled: boolean;
  dailyHeading: string;
  maxTagsPerTarget: number;
}

export interface AiConfigView {
  config: AiConfig;
  hasKey: boolean;
  secretAvailable: boolean;
}

export interface AiTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

/** 「获取可用模型」：地址可先于保存试用；`apiKey` 为空时只复用同源的已存密钥。 */
export interface AiListModelsRequest {
  baseUrl: string;
  apiKey?: string | null;
}

export type AiTagMode = "item" | "app";

export interface AiTagTarget {
  id: string;
  text: string;
}

export interface AiTagCandidate {
  key: string;
  label: string;
}

export interface AiSuggestRequest {
  mode: AiTagMode;
  targets: AiTagTarget[];
  candidates: AiTagCandidate[];
}

export interface AiTagSuggestion {
  id: string;
  tags: string[];
}

export interface AiSuggestResponse {
  suggestions: AiTagSuggestion[];
  stats: {
    parsed: number;
    dropped: number;
    attempts: number;
    batches?: number;
    failedBatches?: number;
  };
}

export interface AiDailySummary {
  date: string;
  markdown: string;
  path: string | null;
  at: number;
}