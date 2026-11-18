/**
 * Timing — 浏览器 Mock：事项标签 + AI（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 纯浏览器下没有 Rust、没有密钥存储、也不该真的发网络请求：
 *   - 标签读写落内存（`s.itemTags`），语义与 `repositories/item_tags.rs` 同形；
 *   - 「测试连接」只在有 key 时回成功，明确标注未发真实请求；
 *   - 标签建议给第一个候选，便于走通「预览 → 应用」的界面流程；
 *   - 今日汇总只拼一段示例 Markdown，不写文件。
 */
import type {
  AiConfig,
  AiConfigView,
  AiDailySummary,
  AiSuggestRequest,
  AiSuggestResponse,
  AiTestResult,
  ItemTags,
} from '../types/domain/ai';
import { fail, now, type MockState } from './mockSeed';
import { normalizeTagPaths } from '../../shared/tags/normalize';

const DEFAULT_CONFIG: AiConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  dailyEnabled: false,
  itemTagsEnabled: true,
  appTagsEnabled: true,
  dailyHeading: '#### AI 今日汇总',
  maxTagsPerTarget: 3,
};

function normalizeTags(input: string[]): string[] {
  return normalizeTagPaths(input, 32);
}

export function createMockApiTagsAi(s: MockState): Record<string, (args?: any) => unknown> {
  let config: AiConfig = { ...DEFAULT_CONFIG };
  let hasKey = false;
  const view = (): AiConfigView => ({ config: { ...config }, hasKey, secretAvailable: true });

  return {
    list_item_tags: (): ItemTags[] =>
      s.items
        .filter((item) => item.status === 'active')
        .map((item) => ({ itemId: item.id, tags: [...(s.itemTags[item.id] ?? [])] })),
    set_item_tags: (a) => {
      const itemId = Number(a?.itemId);
      if (!s.items.some((item) => item.id === itemId && item.status === 'active')) {
        fail('ITEM_NOT_FOUND', '事项不存在');
      }
      let tags: string[];
      try {
        tags = normalizeTags(Array.isArray(a?.tags) ? a.tags : []);
      } catch (error) {
        fail('INVALID_TAG_PATH', error instanceof Error ? error.message : '标签路径不合法');
      }
      s.itemTags[itemId] = tags;
      return [...tags];
    },

    ai_config_get: () => view(),
    ai_config_save: (a) => {
      config = { ...config, ...(a?.config ?? {}) };
      if (a?.apiKey !== undefined && a?.apiKey !== null) {
        hasKey = String(a.apiKey).trim().length > 0;
      }
      return view();
    },
    ai_test: (): AiTestResult =>
      hasKey
        ? { ok: true, message: '浏览器预览：连接成功（未发真实请求）', latencyMs: 12 }
        : { ok: false, message: '还没有保存 API Key', latencyMs: 0 },
    ai_list_models: (a): string[] => {
      const draft = String(a?.request?.apiKey ?? '').trim();
      if (!draft && !hasKey) fail('IO_ERROR', '还没有保存 API Key');
      return ['deepseek-chat', 'deepseek-reasoner'];
    },
    ai_suggest_tags: (a): AiSuggestResponse => {
      const request = a?.request as AiSuggestRequest;
      const candidate = request?.candidates?.[0];
      const suggestions = candidate ? (request.targets ?? []).map((target) => ({
        id: target.id,
        tags: [candidate.key],
      })) : [];
      return { suggestions, stats: { parsed: suggestions.length, dropped: 0, attempts: 1 } };
    },
    ai_daily_summary: (): AiDailySummary => {
      const totalSec = s.records.reduce((sum, record) => sum + record.accumulatedSec, 0);
      return {
        date: new Date().toISOString().slice(0, 10),
        markdown: `**总览**\n\n今天共记录 ${Math.round(totalSec / 60)} 分钟。\n\n- 浏览器预览中的示例汇总\n- 真实内容由 AI 生成`,
        path: null,
        at: now(),
      };
    },
  };
}