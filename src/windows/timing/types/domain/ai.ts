/**
 * Timing — AI 与事项标签的 IPC 形状（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 与 `models/ai.rs` / `models/item_tags.rs` 逐字对齐。密钥**从不在这里**：
 * 保存走 `apiKey` 入参（三态），读回只有 `hasKey`。
 */

/** 事项的多标签（`items.tags` JSON 列；`学习/考公` 用 `/` 表示嵌套）。 */
export interface ItemTags {
  itemId: number;
  tags: string[];
}

/** 改名 / 删除标签后的结果（与 `models/item_tags.rs::TagMutation` 逐字对齐）。 */
export interface TagMutation {
  /** 被改到（或被删到）的未删除事项条数 */
  items: number;
  /** 操作后的全部标签定义 */
  definitions: string[];
}

export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** 汇总结果是否写进日记 md；关着时只预览 */
  dailyEnabled: boolean;
  itemTagsEnabled: boolean;
  appTagsEnabled: boolean;
  /** md 区块标题，必须是 `#### 文字` */
  dailyHeading: string;
  maxTagsPerTarget: number;
}

export interface AiConfigView {
  config: AiConfig;
  /** 凭据存储里有没有密钥；视图永远拿不到明文 */
  hasKey: boolean;
  /** 当前平台能不能存密钥（桌面 DPAPI / 手机 Keystore） */
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

export type AiTagMode = 'item' | 'app';

/** `id` 由调用方定义（事项 id 字符串 / 应用 exe），后端原样回传。 */
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
  /** 已按候选表校验过的键；模型编造的值不会出现 */
  tags: string[];
}

export interface AiSuggestResponse {
  suggestions: AiTagSuggestion[];
  stats: { parsed: number; dropped: number; attempts: number; batches?: number; failedBatches?: number };
  /** 模型**新建**的标签路径（不在候选表里的那些）。老后端不返回，按空数组处理。 */
  created?: string[];
}

export interface AiDailySummary {
  date: string;
  markdown: string;
  /** 写进哪个 md；null = 只预览 */
  path: string | null;
  at: number;
}