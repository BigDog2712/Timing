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
  /**
   * 这条对象当前已有的标签（应用 = override.tags，事项 = items.tags）。
   * 省略等于「没有」；带上它模型才知道"重新判断"该保留什么。
   */
  existing?: string[];
}

export interface AiTagCandidate {
  key: string;
  label: string;
  /** 该标签在用户数据里出现的次数；0/省略 = 不告诉模型频次 */
  used?: number;
}

/** 一条「用户过去怎么打标」的例子，作为 few-shot 记忆喂给模型。 */
export interface AiTagExample {
  text: string;
  tags: string[];
}

export interface AiSuggestRequest {
  mode: AiTagMode;
  targets: AiTagTarget[];
  candidates: AiTagCandidate[];
  /** 相似历史条目；后端裁剪到 12 条后拼进提示词 */
  examples?: AiTagExample[];
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
  /**
   * 模型新建的标签路径（候选表里没有、按「一级白名单 + 最多两级」过了守门的那些）。
   * 它们**已经**在 `suggestions[].tags` 里，这里单列一份是为了让调用方在写库之前
   * 补一条定义行（`tag.def.*`）—— 否则标签只跟着这一条记录存在，改完就散。
   * 0.12.5 起分析窗侧也读它（`Ai 自动打标签`）。
   */
  created?: string[];
}

export interface AiDailySummary {
  date: string;
  markdown: string;
  path: string | null;
  at: number;
}