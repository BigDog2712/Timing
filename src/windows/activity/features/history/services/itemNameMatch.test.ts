/**
 * Timing — P1-06 事项名建议：§4.4 判据表的镜像（14 组含 6 组负例 + 1 组补闸）
 * -----------------------------------------------------------------------------
 * 本文件就是 `docs/fusion/FUSION-ARCH-P1-v1.md` §4.4 那张表的可执行副本，**逐行对应**：
 * 用例名后半句 = 表里「钉住什么」那一列。改算法先改这张表，别改断言迁就实现。
 *
 * 与 §4.4 的三处**算术修正**（决策全部不变，只是长度按 N3 算出来不一样——表里那几格
 * 是把空格算进去了，而 N3 明确要求删空格）：
 *  · #4 `Chrome` / `Google Chrome`：6/12 = **0.5**（表写 6/13 = 0.46）→ 仍 < 0.6，仍 `null`
 *  · #5 `Chrome` / `Chrome 浏览器`：6/9 = 0.67 ✓ 与表一致
 *  · #11/#12 `VS Code` / `VS Code 调试`：6/8 = **0.75**（表写 7/9 = 0.78）→ 仍是两组里更高的那个
 *  · #13 备注「后者 3/6 = 0.5 不达标」：N3 后是 3/5 = 0.6 **达标**，但 `exact`(1.0) 压过它，
 *    决策一样；这条因此同时钉住「exact 优先」而不是「contained 不达标」。
 *
 * 表外加 #15：`微信` / `微信版`（2/3 = 0.667 ≥ 0.6）。§4.4 只用 #7（单字）想钉住
 * 「短串 ≥3」这道闸，但 #7 的两组候选 1/4 = 0.25、1/2 = 0.5 都低于 0.6，光靠比值闸就
 * 已经是 null —— 那道闸在 #7 上**不可观测**。#15 才是它唯一能被变异变红的地方。
 */
import { describe, expect, it } from 'vitest';

import {
  normalizeItemName,
  suggestItemName,
  type ItemNameCandidate,
} from './itemNameMatch.ts';

const mk = (...names: string[]): ItemNameCandidate[] => names.map((name, i) => ({ id: i + 1, name }));

/** 只断言判据表里的三列（`id` 是夹具细节，不进判据） */
function shape(activity: string, items: ItemNameCandidate[]) {
  const hit = suggestItemName(activity, items);
  if (hit === null) return null;
  return { kind: hit.kind, score: hit.score, item: hit.item.name };
}

describe('itemNameMatch（P1-06 §4.4 判据表）', () => {
  it('row01_vs_code_matches_vscode_after_space_strip_and_lowercase', () => {
    expect(shape('VS Code', mk('写代码', 'VSCode')))
      .toEqual({ kind: 'exact', score: 1, item: 'VSCode' });
  });

  it('row02_fullwidth_nfkc_makes_it_equal', () => {
    /* N1：`ＶＳ` + 全角空格（U+3000）+ `ＣＯＤＥ` → `vscode`；用转义写，源码里不放不可见字符 */
    expect(shape('ＶＳ\u3000ＣＯＤＥ', mk('vs code')))
      .toEqual({ kind: 'exact', score: 1, item: 'vs code' });
  });

  it('row03_cross_language_is_a_negative_no_dictionary', () => {
    expect(shape('vscode', mk('写代码'))).toBeNull();
  });

  it('row04_chrome_vs_google_chrome_is_a_negative_ratio_below_threshold', () => {
    expect(shape('Chrome', mk('Google Chrome'))).toBeNull();
  });

  it('row05_chrome_vs_chrome_browser_is_a_contained_hit', () => {
    const hit = shape('Chrome', mk('Chrome 浏览器'));
    expect(hit?.kind).toBe('contained');
    expect(hit?.item).toBe('Chrome 浏览器');
    expect(hit?.score).toBeCloseTo(6 / 9, 5);
  });

  it('row06_two_char_short_string_is_a_negative_ratio_guard', () => {
    /* 2/5 = 0.4 < 0.6（比值闸）。注意：本组在「短串 ≥3」闸下也会被挡，#15 才单独钉那道闸 */
    expect(shape('微信', mk('微信电脑版'))).toBeNull();
  });

  it('row07_single_char_never_matches', () => {
    expect(shape('会', mk('会议纪要', '开会'))).toBeNull();
  });

  it('row08_exactly_point_six_passes_because_the_judge_is_gte', () => {
    /* 3/5 = 0.6 **恰好达标**：判据是 `>=` 不是 `>` */
    expect(shape('记事本', mk('记事本-长期')))
      .toEqual({ kind: 'contained', score: 0.6, item: '记事本-长期' });
  });

  it('row09_blank_activity_name_is_a_negative_empty_after_normalize', () => {
    expect(shape('', mk('任一'))).toBeNull();
    expect(shape('   ', mk('任一'))).toBeNull();
  });

  it('row10_empty_library_is_a_negative_no_crash', () => {
    expect(shape('VS Code', [])).toBeNull();
  });

  it('row11_best_score_wins_when_two_candidates_both_look_close', () => {
    /* 6/8 = 0.75 > 6/9 = 0.667 —— 两个都像时取高分，不并列 */
    const hit = shape('VS Code', mk('VS Code 调试', 'VS Code 写代码'));
    expect(hit?.item).toBe('VS Code 调试');
    expect(hit?.score).toBeCloseTo(6 / 8, 5);
  });

  it('row12_same_assertion_with_the_library_order_reversed', () => {
    /* 结果与库顺序无关：同分/异分都不许因为「谁先读出来」而变 */
    const hit = shape('VS Code', mk('VS Code 写代码', 'VS Code 调试'));
    expect(hit?.item).toBe('VS Code 调试');
    expect(hit?.score).toBeCloseTo(6 / 8, 5);
  });

  it('row13_exact_beats_contained', () => {
    expect(shape('写代码', mk('写代码', '写代码（重构）')))
      .toEqual({ kind: 'exact', score: 1, item: '写代码' });
  });

  it('row14_exact_is_the_only_hit_even_with_a_longer_sibling', () => {
    expect(shape('WeChat', mk('wechat', 'WeChat 工作号')))
      .toEqual({ kind: 'exact', score: 1, item: 'wechat' });
  });

  it('row15_two_char_short_string_is_blocked_by_the_min_length_gate', () => {
    /* 表外补闸：2/3 = 0.667 ≥ 0.6，只有「短串 ≥3」能挡住它 —— 那是本文件里该闸唯一的观测点 */
    expect(shape('微信', mk('微信版'))).toBeNull();
  });
});

describe('normalizeItemName（§4.2 归一化顺序）', () => {
  it('n1_nfkc_folds_fullwidth_and_chinese_punctuation', () => {
    /* 手写 0xFEE0 映射表在中文括号上必漏，NFKC 一次搞定 */
    expect(normalizeItemName('ＶＳ\u3000ＣＯＤＥ')).toBe('vscode');
    expect(normalizeItemName('写代码（重构）')).toBe('写代码重构');
    expect(normalizeItemName('２５')).toBe('25');
  });

  it('n3_keeps_cjk_because_it_is_unicode_letter', () => {
    /* 换成 `[a-z0-9]` 会把中文全删空 —— 这一行是本算法最容易写错的地方 */
    expect(normalizeItemName('写代码')).toBe('写代码');
    expect(normalizeItemName('a.b-c_d')).toBe('abcd');
    expect(normalizeItemName('  ')).toBe('');
  });
});
