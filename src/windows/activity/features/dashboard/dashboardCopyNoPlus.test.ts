import { describe, expect, it } from "vitest";

import { TIMELINE_MANAGE_COPY } from "./copyTimeline.ts";
import { TODO_COPY } from "./copyTodos.ts";
import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 需求 6「去掉『新建事项』『新建待办』前的加号」——**四语言判据**。
 *
 * 这两颗键现在**没有任何测试直接断言**：zh-CN 的「新建待办」只被 `TodosModule.test`
 * 通过 `byText` 间接用到（加号回来会顺带变红），而「新建事项」与 en / ru / es 三套文案
 * 完全没有覆盖 —— 任何一次"顺手补回全角＋"的改动都不会被发现。
 *
 * 判据刻意写成"不许以任何加号开头"而不是"必须等于某个字符串"：文案本身还会继续改，
 * 但"入口靠位置与颜色区分，不靠加号"这个决定是需求。
 */
const LOCALES: Locale[] = ["zh-CN", "en-US", "ru-RU", "es"];
const PLUS_PREFIX = /^\s*[+＋]/;

describe("新建入口文案 · 去加号（四语言）", () => {
  it("cp01_the_timeline_new_item_entry_has_no_plus_prefix_in_any_locale", () => {
    for (const locale of LOCALES) {
      const text = TIMELINE_MANAGE_COPY[locale].timelineNewItem;
      expect(text.trim(), `${locale} 的「新建事项」不许带加号`).not.toBe("");
      expect(text, `${locale}: ${text}`).not.toMatch(PLUS_PREFIX);
    }
  });

  it("cp02_the_todo_new_entry_has_no_plus_prefix_in_any_locale", () => {
    for (const locale of LOCALES) {
      const text = TODO_COPY[locale].todoNewTodo;
      expect(text.trim(), `${locale} 的「新建待办」不许带加号`).not.toBe("");
      expect(text, `${locale}: ${text}`).not.toMatch(PLUS_PREFIX);
    }
  });

  it("cp03_no_other_dashboard_copy_still_carries_a_full_width_plus", () => {
    /* 「编辑事项」「事项管理」等同一组按钮曾经统一用全角＋起头；一并钉住，
       免得只改了两颗、剩下的还在视觉上不一致。 */
    for (const locale of LOCALES) {
      const timeline = Object.values(TIMELINE_MANAGE_COPY[locale]);
      const todos = Object.values(TODO_COPY[locale]);
      const offenders = [...timeline, ...todos]
        .filter((value): value is string => typeof value === "string")
        .filter((value) => value.includes("＋"));
      expect(offenders, `${locale} 仍有文案带全角加号`).toEqual([]);
    }
  });
});
