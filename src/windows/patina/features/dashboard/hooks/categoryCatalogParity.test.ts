/**
 * parity 判据：**共享 zh 表 ↔ patina `uiText.categories` 十键逐字相等**（[0.14]）。
 *
 * 共享层 `categoryCatalog.ts` 的 `BUILTIN_CATEGORY_LABELS_ZH` 是药丸窗（zh-only）
 * 注入的内置分类名；分析窗走 `getCategoryToken(key, UI_TEXT)`。两窗展示同一份
 * 候选，同一个键在两边显示不同的词就是最直观的漂移 —— 所以这一侧钉逐字相等：
 * 改词只改一边，parity 红。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { loadLocaleText, type UiText } from "../../../shared/i18n/index.ts";
import { getCategoryToken, type AppCategory } from "../../../shared/classification/categoryTokens.ts";
import {
  BUILTIN_CATEGORY_KEYS,
  BUILTIN_CATEGORY_LABELS_ZH,
} from "../../../../shared/classification/categoryCatalog.ts";

let UI_TEXT: UiText;

beforeAll(async () => {
  UI_TEXT = await loadLocaleText("zh-CN");
});

describe("共享 zh 表 ↔ patina uiText.categories 十键逐字相等", () => {
  it("十键逐字相等（含 ai 专属文案；other/system 不在共享表）", () => {
    expect([...BUILTIN_CATEGORY_KEYS]).toHaveLength(10);
    for (const key of BUILTIN_CATEGORY_KEYS) {
      const patinaLabel = getCategoryToken(key as AppCategory, UI_TEXT).label;
      expect(BUILTIN_CATEGORY_LABELS_ZH[key], `键 ${key} 的 zh 名两侧不一致`).toBe(patinaLabel);
    }
  });

  it("共享表恰好十键，不带 other / system / 匿名", () => {
    expect(Object.keys(BUILTIN_CATEGORY_LABELS_ZH).sort()).toEqual([...BUILTIN_CATEGORY_KEYS].sort());
  });
});
