/**
 * [0.13 · 需求 1.3 / 1.4] 组件板文案的四语言判据（V-1.4b）。
 *
 * 为什么这条必须存在：`BOARD_COPY` 是**手写表**（不进 `shared/i18n/**` 的位置数组，
 * 理由见文件头）。手写表最常见的坏法有两种，两种都不报错：
 *   ① 加了键只补了 zh / en —— ru / es 用户看到的是 `undefined`（界面上直接空一块）；
 *   ② 补了键但直接抄英文 —— 界面能看，等于「静默降级成英文」。
 * 所以这里逐条钉：键集相等 + 函数键数量相等 + ru/es 的每一句都不等于英文那句。
 */
import { describe, expect, it } from "vitest";
import { BOARD_COPY, type BoardCopy } from "./boardCopy";

const LOCALES = ["zh-CN", "en-US", "ru-RU", "es"] as const;

/** `sizes` 是 S/M/L 三个字母，四语言**本来就该一样**（它们是尺寸档的代号，不是词）。 */
const LOCALE_INVARIANT = new Set<keyof BoardCopy>(["sizes"]);

const BASE_KEYS = Object.keys(BOARD_COPY["zh-CN"]).sort();

function functionKeys(copy: BoardCopy): string[] {
  return BASE_KEYS.filter((key) => typeof copy[key as keyof BoardCopy] === "function");
}

/** 把一条文案取成字符串（函数键用一个稳定的实参求值）。 */
function sample(copy: BoardCopy, key: keyof BoardCopy): string {
  const value = copy[key];
  if (typeof value === "function") return String((value as (n: number) => string)(2));
  return typeof value === "string" ? value : "";
}

describe("V-1.4b 四语言键集", () => {
  it("v14b_all_four_locales_declare_the_same_keys", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(BOARD_COPY[locale]).sort(), `${locale} 的键集与 zh-CN 不一致`)
        .toEqual(BASE_KEYS);
    }
  });

  it("v14b_function_keys_count_matches_across_locales", () => {
    const expected = functionKeys(BOARD_COPY["zh-CN"]);
    expect(expected.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(functionKeys(BOARD_COPY[locale]), `${locale} 的函数键不一致`).toEqual(expected);
    }
  });

  it("v14b_every_string_is_present_and_non_empty", () => {
    for (const locale of LOCALES) {
      for (const key of BASE_KEYS) {
        if (LOCALE_INVARIANT.has(key as keyof BoardCopy)) continue;
        expect(sample(BOARD_COPY[locale], key as keyof BoardCopy), `${locale}.${key} 空着`)
          .not.toBe("");
      }
    }
  });

  it("v14b_ru_and_es_never_fall_back_to_english", () => {
    const en = BOARD_COPY["en-US"];
    for (const locale of ["ru-RU", "es"] as const) {
      for (const key of BASE_KEYS) {
        if (LOCALE_INVARIANT.has(key as keyof BoardCopy)) continue;
        const value = sample(BOARD_COPY[locale], key as keyof BoardCopy);
        expect(value, `${locale}.${key} 与英文逐字相同（静默降级）`)
          .not.toBe(sample(en, key as keyof BoardCopy));
      }
    }
  });
});
