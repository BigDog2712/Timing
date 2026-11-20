import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * [0.12.6 · P0-9] 工具标签的统计口径（`dashboardReadModel` 是**唯一**实现点）。
 *
 * ## 判据为什么钉在读模型上，而不是钉在组件上
 *
 * "工具类不计入统计"有三个消费点（总量 / 分类分布 / 排行占比），如果每个组件各自过滤，
 * 迟早会出现"分布里没了、总量里还在"这种半拉子状态 —— 用户看到的是两个数字互相矛盾。
 * 所以过滤只留在 `dashboardReadModel.buildDashboardReadModel` 一处，本文件从入口进、
 * 从出口断言：
 *   · `totalTrackedTime` / `categoryDist` **不含**工具类（`tw01`）；
 *   · `topApplications` **仍含**工具类，且 `isTool=true`、占比记 0（`tw02`）；
 *   · `excludedToolTime` = 被拿掉的那部分（"我的总时长为什么少了"的唯一解释）；
 *   · 环比（`dayDeltaTrackedTime`）与今日同一口径，否则"今天"和"昨天"不可比（`tw03`）；
 *   · 三个消费点（应用维度 / 排行卡头 / `totalTrackedTime`）逐毫秒同量（`tw07`，M1 回归）。
 *
 * 变异靶点：把 `categoryDist: buildCategoryDistribution(toolSplit.counted)` 改回
 * `buildCategoryDistribution(stats)` → tw01 红；把 `splitToolStats` 恒返回全量 →
 * tw01 / tw02 / tw03 全红。
 */
import { buildDashboardReadModel, type DashboardReadModel } from "./dashboardReadModel.ts";
import { buildFocusDistribution } from "./focusDimension.ts";
import { ProcessMapper } from "../../../shared/classification/processMapper.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
import { resolveTrackerHealth, TRACKER_HEARTBEAT_STALE_AFTER_MS } from "../../../shared/types/tracking.ts";

const HOUR = 3_600_000;

/** 固定的"今天中午"：所有会话都落在同一天里，不受跑测试的时刻影响 */
const NOW = new Date(2026, 10, 20, 12, 0, 0, 0).getTime();
const at = (hour: number, minute = 0) => new Date(2026, 10, 20, hour, minute, 0, 0).getTime();

function record(exeName: string, appName: string, startHour: number, durationMs: number): AggregateSessionRecord {
  const startTime = at(startHour);
  return { appName, exeName, startTime, endTime: startTime + durationMs };
}

function readModel(
  today: AggregateSessionRecord[],
  yesterday: AggregateSessionRecord[] = [],
): DashboardReadModel {
  const health = resolveTrackerHealth(NOW, NOW, TRACKER_HEARTBEAT_STALE_AFTER_MS);
  return buildDashboardReadModel(today, health, NOW, yesterday);
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

beforeEach(() => {
  /* 分类是模块级静态表：不清的话前一条用例的标签会漏到后一条里 */
  AppClassification.setAppLinks({});
  ProcessMapper.clearUserOverrides();
  ProcessMapper.setUserOverride("idm.exe", { tags: ["工具"] });
  ProcessMapper.setUserOverride("wt.exe", { tags: ["工具/终端"] });
});

afterEach(() => {
  ProcessMapper.clearUserOverrides();
  AppClassification.setAppLinks({});
});

describe("[P0-9] 工具标签的统计口径", () => {
  const TODAY = [
    record("code.exe", "VS Code", 9, HOUR),
    record("idm.exe", "Internet Download Manager", 10, HOUR),
    record("wt.exe", "Windows Terminal", 11, HOUR / 2),
  ];

  it("tw01_总量与分类分布都不含工具类_但统计明细照旧是全量", () => {
    const model = readModel(TODAY);

    /* 只有写代码那 1h 计入（IDM 1h + Terminal 0.5h 都被工具标签排除） */
    expect(model.totalTrackedTime, "工具类的时长还在总量里").toBe(HOUR);
    expect(sum(model.categoryDist.map((item) => item.value)), "分布里仍然带着工具类").toBe(HOUR);
    expect(model.excludedToolTime, "被排除的时长要能被解释").toBe(HOUR + HOUR / 2);
    /* 逐行事实不被统计口径改写：三行都在 */
    expect(model.stats.map((stat) => stat.exeName)).toEqual(["code.exe", "idm.exe", "wt.exe"]);
  });

  it("tw02_排行仍含工具类_标注 isTool 且占比记 0", () => {
    const model = readModel(TODAY);
    const byExe = new Map(model.topApplications.map((item) => [item.exeName, item]));

    expect(byExe.size, "工具类不许从排行里消失（否则用户查不到「我的时长去哪了」）").toBe(3);
    expect(byExe.get("idm.exe")?.isTool).toBe(true);
    expect(byExe.get("wt.exe")?.isTool).toBe(true);
    expect(byExe.get("code.exe")?.isTool).toBe(false);
    /* 工具类的时长照实显示，但不参与占比（分母已经把它们拿掉了，硬算会 >100%） */
    expect(byExe.get("idm.exe")?.duration).toBe(HOUR);
    expect(byExe.get("idm.exe")?.percentage).toBe(0);
    expect(byExe.get("code.exe")?.percentage, "分母是已计入的合计（1h）").toBe(100);
  });

  it("tw03_环比与今日同一口径_昨天的工具类也不计入", () => {
    const model = readModel(TODAY, [record("idm.exe", "Internet Download Manager", 10, HOUR)]);

    expect(model.yesterdayTrackedTime, "昨天的工具类被算进了基数 → 环比不可比").toBe(0);
    expect(model.dayDeltaTrackedTime).toBe(HOUR);
  });

  it("tw04_全部都是工具类时总量为 0_分布为空", () => {
    const model = readModel([
      record("idm.exe", "Internet Download Manager", 10, HOUR),
      record("wt.exe", "Windows Terminal", 11, HOUR),
    ]);

    expect(model.totalTrackedTime).toBe(0);
    expect(model.categoryDist, "全是工具类时不该画出任何分布").toEqual([]);
    expect(model.excludedToolTime).toBe(2 * HOUR);
    /* 排行仍要能看到这两行（卡片会走"本期无可统计时长"的分支） */
    expect(model.topApplications.every((item) => item.isTool === true)).toBe(true);
  });

  it("tw05_工具子标签与一级工具标签同等对待", () => {
    /* `工具/终端` 是二级细分：前缀命中，与裸 `工具` 一样被排除 */
    const model = readModel([record("wt.exe", "Windows Terminal", 11, HOUR)]);
    expect(model.totalTrackedTime).toBe(0);
    expect(model.topApplications[0]?.isTool).toBe(true);
  });

  it("tw06_未打标签的应用照常计入统计", () => {
    ProcessMapper.clearUserOverrides();
    const model = readModel([record("idm.exe", "Internet Download Manager", 10, HOUR)]);

    expect(model.totalTrackedTime).toBe(HOUR);
    expect(model.excludedToolTime).toBe(0);
    expect(model.topApplications[0]?.isTool).toBe(false);
  });

  /**
   * [0.12.6 · M1] 三个消费点必须是同一个数。
   *
   * QA 那一组：`totalTrackedTime=1h, excludedToolTime=2h`，而应用维度合计 3h、
   * 排行卡头也 3h —— 用户在同一块板上看见 1h 和 3h，没有任何办法知道哪个是对的。
   * 这条钉的是**读模型给出去的原料**：`topApplications` 里把 `isTool` 的行按 0 计，
   * 剩下的合计必须逐毫秒等于 `totalTrackedTime`；应用维度（`fromApplications`）同理。
   * 组件自己那两处（卡头 `meta` / 读数行百分比）分别钉在
   * `AppsModule.test.tsx`（apps15）与 `TimerModuleSource.test.tsx`（tm06）。
   */
  it("tw07_应用维度与排行卡头都只吃已计入的合计", () => {
    const model = readModel(TODAY);
    const byApp = buildFocusDistribution("app", {
      categories: model.categoryDist,
      applications: model.topApplications,
      items: [],
    });

    expect(byApp.total, "应用维度把工具类的时长加回来了").toBe(model.totalTrackedTime);
    expect(byApp.slices.map((slice) => slice.key), "工具类跑进了应用维度的环").toEqual(["code.exe"]);
    /* 切片带着读模型算好的百分比（100 = 分母是已计入的 1h，不是全量 2.5h） */
    expect(byApp.slices[0]?.percentage).toBe(100);

    const headTotal = model.topApplications.reduce(
      (sum, app) => sum + (app.isTool === true ? 0 : Math.max(0, app.duration)),
      0,
    );
    expect(headTotal, "排行卡头合计与计时卡不是同一个数").toBe(model.totalTrackedTime);
    /* 工具行仍在列表里（有 `isTool` 标记），只是不进合计 */
    expect(model.topApplications.filter((app) => app.isTool === true).map((app) => app.exeName))
      .toEqual(["idm.exe", "wt.exe"]);
  });
});
