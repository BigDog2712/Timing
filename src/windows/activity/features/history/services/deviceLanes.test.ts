import { describe, expect, it } from "vitest";

import { buildDeviceLanes } from "./deviceLanes.ts";
import { deviceColor, deviceShortLabel, fnv1a32 } from "../../../shared/lib/deviceColor.ts";

/**
 * 「单设备 → 空数组」是 P2 最重要的一条数据层断言。
 *
 * 它不写在组件里，是因为组件里的 `if (devices.length > 1)` 会随着加 chip / 加图例
 * 一个个长出来，而没有任何用例会因为漏掉一处而变红；写在这里之后，「有几台设备」
 * 全应用只有一个答案。
 */
describe("buildDeviceLanes", () => {
  it("单设备返回空数组（界面因此一个设备节点都不该有）", () => {
    expect(buildDeviceLanes([{ deviceId: "aaa111" }, { deviceId: "aaa111" }], "aaa111")).toEqual([]);
  });

  it("没有 deviceId（旧快照/旧夹具）也按单设备处理", () => {
    expect(buildDeviceLanes([{}, {}], null)).toEqual([]);
  });

  it("完全没有会话时不产出泳道", () => {
    expect(buildDeviceLanes([], "aaa111")).toEqual([]);
  });

  it("两台设备时本机排第一，其余按 id 升序", () => {
    const lanes = buildDeviceLanes(
      [{ deviceId: "zzz999" }, { deviceId: "aaa111" }, { deviceId: "www000" }],
      "www000",
    );
    expect(lanes.map((lane) => lane.deviceId)).toEqual(["www000", "aaa111", "zzz999"]);
    expect(lanes[0].isSelf).toBe(true);
    expect(lanes.slice(1).every((lane) => !lane.isSelf)).toBe(true);
  });

  it("selfDeviceId 不在会话里时不去硬认（按 id 升序，全部 isSelf=false）", () => {
    const lanes = buildDeviceLanes([{ deviceId: "bbb" }, { deviceId: "aaa" }], "self-not-present");
    expect(lanes.map((lane) => lane.deviceId)).toEqual(["aaa", "bbb"]);
    expect(lanes.some((lane) => lane.isSelf)).toBe(false);
  });
});

describe("deviceColor", () => {
  it("同一台设备永远同一个颜色（跨机器一致的前提）", () => {
    expect(deviceColor("b265fafdc306")).toBe(deviceColor("b265fafdc306"));
  });

  it("FNV-1a 32 位有确定的已知值（换算法就必须改这里）", () => {
    /* 这两个值是手算 + 实现两边一致的钉子：`""` 的 FNV-1a offset basis，
       以及 "a" = (0x811c9dc5 ^ 0x61) * 0x01000193 */
    expect(fnv1a32("")).toBe(0x811c_9dc5);
    expect(fnv1a32("a")).toBe(Math.imul(0x811c_9dc5 ^ 0x61, 0x0100_0193) >>> 0);
  });

  it("空 id 给中性令牌而不是色相（不参与轮盘）", () => {
    expect(deviceColor("   ")).toBe("var(--at-text-tertiary)");
  });

  it("短名取前 6 位", () => {
    expect(deviceShortLabel("b265fafdc306")).toBe("b265fa");
    expect(deviceShortLabel("abc")).toBe("abc");
  });
});
