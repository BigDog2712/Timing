import { describe, expect, it } from "vitest";

import { validateRecordTime } from "./recordTimeEdit";

/**
 * 「改起止」边界校验的判据（0.13 · T03b §3.8，B1–B6）。
 *
 * 这条链上**没有一条**会抛错：Rust `update_record` 对非法区间有自己的归一，
 * 跨零点的记录会被 `useTodayItems` 的日区间过滤把**整天**算给起始日 ——
 * 症状全是静默的（账单错一天、时长翻倍），所以六条规则 + 判定顺序必须在前端
 * 这一个函数里钉死。顺序即判据：`notSaved` 必须赢过 `crossDay`（进行中的段
 * 无论填什么都该先说"不能改"，而不是先聊边界）。
 */

/* 本地日 [0 点, 次日 0 点)：2026-11-11 */
const DAY_START = new Date(2026, 10, 11, 0, 0, 0).getTime();
const DAY_END = DAY_START + 86_400_000;
const H = 3_600_000;

/** 合法底座：一条已保存的 09:00–10:00 记录，改法默认在日内 */
const SAVED = { startedAt: DAY_START + 9 * H, endedAt: DAY_START + 10 * H, status: "saved" };

describe("validateRecordTime · 六条边界与判定顺序", () => {
  it("r01_a_valid_same_day_edit_passes", () => {
    /* B1 + B2 都满足：改到 09:30–09:45 合法 */
    expect(validateRecordTime(
      { startedAt: DAY_START + 9.5 * H, endedAt: DAY_START + 9.75 * H },
      SAVED,
      DAY_START,
      DAY_END,
    )).toBeNull();
    /* 改成整天两端也合法（起止恰好落在日界上是允许的） */
    expect(validateRecordTime(
      { startedAt: DAY_START, endedAt: DAY_END },
      SAVED,
      DAY_START,
      DAY_END,
    )).toBeNull();
  });

  it("r02_not_saved_wins_over_everything_b3", () => {
    /* B3：进行中的记录前端就要拒 —— 宿主对非 saved 回的是误导性的 ITEM_NOT_FOUND。
       顺序判据：就算新起止同时跨零点，也先报 notSaved（"这条改不了"优先于边界） */
    expect(validateRecordTime(
      { startedAt: DAY_START, endedAt: DAY_END + H },
      { startedAt: DAY_START + 9 * H, endedAt: null, status: "running" },
      DAY_START,
      DAY_END,
    )).toBe("notSaved");
    /* endedAt 缺失的脏 saved 行同走 B3 文案（endMissing → 只读） */
    expect(validateRecordTime(
      { startedAt: DAY_START, endedAt: DAY_END },
      { startedAt: DAY_START + 9 * H, endedAt: null, status: "saved" },
      DAY_START,
      DAY_END,
    )).toBe("endMissing");
  });

  it("r03_end_before_start_is_rejected_b1_strict", () => {
    /* B1 严格小于：倒挂拒绝 */
    expect(validateRecordTime(
      { startedAt: DAY_START + 10 * H, endedAt: DAY_START + 9 * H },
      SAVED,
      DAY_START,
      DAY_END,
    )).toBe("endBeforeStart");
  });

  it("r04_zero_length_record_is_its_own_issue_not_end_before_start", () => {
    /* 起止相同 = 时长 0 的记录不算记录；先于 endBeforeStart 给出更准的语义 */
    expect(validateRecordTime(
      { startedAt: DAY_START + 9 * H, endedAt: DAY_START + 9 * H },
      SAVED,
      DAY_START,
      DAY_END,
    )).toBe("sameInstant");
  });

  it("r05_crossing_midnight_is_rejected_before_it_reaches_rust_b2", () => {
    /* B2：起止必须同一本地日。Rust 不按天拆分 —— 一条 23:50–次日 01:10 的行会被
       useTodayItems 把整天算给起始日且**不报错**，所以必须在落库前拦下 */
    expect(validateRecordTime(
      { startedAt: DAY_START + 23.9 * H, endedAt: DAY_END + 1.2 * H },
      SAVED,
      DAY_START,
      DAY_END,
    )).toBe("crossDay");
    /* 起点落到昨天同理（把一段昨天的行拉进今天） */
    expect(validateRecordTime(
      { startedAt: DAY_START - H, endedAt: DAY_START + H },
      SAVED,
      DAY_START,
      DAY_END,
    )).toBe("crossDay");
    /* 结束恰在次日 0 点 = 24:00，是本日端点，不判跨日 */
    expect(validateRecordTime(
      { startedAt: DAY_START + 23 * H, endedAt: DAY_END },
      SAVED,
      DAY_START,
      DAY_END,
    )).toBeNull();
  });

  it("r06_not_saved_also_beats_a_backwards_range_order_is_the_criterion", () => {
    /* 顺序钉死：非 saved + 倒挂 → notSaved（不是 endBeforeStart） */
    expect(validateRecordTime(
      { startedAt: DAY_START + 10 * H, endedAt: DAY_START + 9 * H },
      { startedAt: DAY_START + 9 * H, endedAt: DAY_START + 10 * H, status: "running" },
      DAY_START,
      DAY_END,
    )).toBe("notSaved");
    /* 倒挂 + 跨日 → endBeforeStart（B1 先于 B2） */
    expect(validateRecordTime(
      { startedAt: DAY_END, endedAt: DAY_START - H },
      SAVED,
      DAY_START,
      DAY_END,
    )).toBe("endBeforeStart");
  });
});
