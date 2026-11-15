import { describe, expect, it } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";

/**
 * [P3 · 0.12.1] D2 判据：两窗的 `HostIntent` 联合类型**逐字一致**。
 *
 * 为什么这条要单独钉：L9 禁止两窗互相 import，所以这个联合类型在两侧各写一份
 * （`src/platform/runtime/hostIntentGateway.ts` 是分析窗，`src/services/hostIntentBridge.ts`
 * 是药丸）。两份声明只要漂一个字段名，症状是**静默的**：`emitTo` 发得出去、宿主 `switch`
 * 落进 default 分支被忽略，零日志、零提示，功能「点了没反应」。
 *
 * 判据只比字形，不比顺序：`action` 字面量集合 + 每条动作带哪些字段名。
 */
function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

/** 从源码里抠出 `| { action: 'x'; a: T; b: T }` 这类条目，归一成 `x{a,b}`。 */
export function extractIntents(source: string): string[] {
  const out: string[] = [];
  const pattern = /\{\s*action:\s*['"]([a-z_]+)['"]\s*;?([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const fields = match[2]
      .split(";")
      .map((part) => part.split(":")[0].trim())
      .filter((name) => name.length > 0)
      .sort();
    out.push(`${match[1]}{${fields.join(",")}}`);
  }
  return out.sort();
}

const gateway = extractIntents(read("../../../platform/runtime/hostIntentGateway.ts"));
const bridge = extractIntents(read("../../../../timing/services/hostIntentBridge.ts"));

describe("HostIntent 两侧镜像", () => {
  it("d02a_both_windows_declare_the_same_actions_and_fields", () => {
    expect(gateway.length).toBeGreaterThan(0);
    expect(bridge).toEqual(gateway);
  });

  it("d02b_the_four_new_invocation_actions_are_present", () => {
    for (const action of ["open_items_menu{}", "open_common_items{}", "open_moyu_menu{}", "open_note{noteId}"]) {
      expect(gateway).toContain(action);
      expect(bridge).toContain(action);
    }
  });

  /* [便利贴可删除] 新增的第六条写意图：字段少写一个（或写成 noteID）都会让宿主 switch
     落进 default —— 症状是"点了删除没反应"，零日志。所以逐字钉一次。 */
  it("d02c_delete_note_carries_the_same_noteId_field_on_both_sides", () => {
    expect(gateway).toContain("delete_note{noteId}");
    expect(bridge).toContain("delete_note{noteId}");
  });

  /* [本轮] 时间线卡的写意图。集合相等（d02a）只能保证"没有多一个动作"，
     保证不了**载荷字段名**：`update_item` 把 `id` 写成 `itemId`、`create_item` 把
     `name` 写成 `itemName`，两侧集合仍然相等（都写错就都一致），而宿主收到的
     `intent.id` 是 `undefined` → `itemApi.update({id: undefined})` → 报错在药丸上，
     分析窗只看到"改名没生效"。所以这里把字段名逐字钉死。
     「事项管理」之后两个动作都长出了 `isPinned` / `sortOrder` / `timerMinutes`：
     少一个字段的症状同样是静默的（用户点了「设为常用」，事项没被置顶）。
     注意抽取器保留可选标记 `?`（`isPinned?: boolean` → 字段名 `isPinned?`）：
     这是「可选 vs 必填」的额外契约，别为了好看把 `?` 从断言里抹掉。 */
  it("d02d_create_item_and_update_item_carry_the_same_fields_on_both_sides", () => {
    /* [0.13] 两个动作都长出了 `categoryKey?`（事项分类）。漏了它的症状同样是静默的：
       用户在下拉里选了分类，药丸侧 `pickItemPatch` 收不到字段 → 库里不写 → 下次刷新弹回未分类。 */
    expect(gateway).toContain("create_item{categoryKey?,isPinned?,name,sortOrder?,timerMinutes?}");
    expect(bridge).toContain("create_item{categoryKey?,isPinned?,name,sortOrder?,timerMinutes?}");
    expect(gateway).toContain("update_item{categoryKey?,id,isPinned?,name?,sortOrder?,timerMinutes?}");
    expect(bridge).toContain("update_item{categoryKey?,id,isPinned?,name?,sortOrder?,timerMinutes?}");
  });

  /* [0.13 · T03b] 本轮唯一的**新语义**意图：改计时记录起止。三条静默失败路径：
     ① 两侧字段名漂一个（recordId 写成 id / startedAt 写成 start）→ 药丸 switch 落进
        default，"点了保存没反应"零日志；② payload 里多塞一个 duration 字段 ——
        Rust `RecordPatch` 没有 duration，serde 静默丢弃（B4：时长必须由 Rust 重算）；
     ③ 两侧只改一边（L9 各写一份）。集合相等（d02a）抓不住 ①②，逐字钉。 */
  it("d02e_update_record_time_carries_the_same_camel_case_fields_on_both_sides", () => {
    expect(gateway).toContain("update_record_time{endedAt,recordId,startedAt}");
    expect(bridge).toContain("update_record_time{endedAt,recordId,startedAt}");
  });

  /* [0.13 fix] 「绑定应用 → 自动计时」的镜像意图。它修的是用户报的「启动了燕云却不计时」：
     两侧漂一个字段（`appKey` 写成 `exeName`、`itemIds` 写成 `itemId`）都会让药丸侧拿到
     `undefined` → 一条绑定都写不进宿主 `item_app` → **永远不接管**，而且两端零日志
     （分析窗只发意图、不承诺结果，用户看到的只是"绑了没用"）。
     所以字段名逐字钉；`track?` 的可选标记也要留着 —— 它是"仅观察 / 计入"的开关。 */
  it("d02f_sync_app_item_bindings_carries_the_same_fields_on_both_sides", () => {
    expect(gateway).toContain("sync_app_item_bindings{appKey,itemIds,track?}");
    expect(bridge).toContain("sync_app_item_bindings{appKey,itemIds,track?}");
  });
});

/**
 * [T04-1 · 设计 §1.6 / §6 G3] 事件名**字面量**的跨窗镜像。
 *
 * 上面那些用例钉的是 `HostIntent` 联合的 action 与字段名（TS 类型层）。但**事件名本身**
 * 是字符串，两窗各写一份常量（L9 禁止跨窗 import），此前没有任何断言让它们相等：
 * 现存的两条断言（`hostIntentBridge.test.ts` / `.itemWrite.test.ts`）**只钉药丸侧**，
 * 所以只改分析窗那侧 `activityEvents.ts` 的值，全仓没有任何测试会红。
 *
 * 症状是纯静默的：`emitTo` 照常发得出去、对侧 `listen` 永远收不到，两端零日志，
 * 用户看到的是「点了没反应」。
 *
 * ②这一条把**命名空间**收敛到本文件唯一一处 `EXPECTED_NAMESPACE`：改名的批次只改那一行，
 * 两侧实现必须同时跟上——漏改任何一侧，下面两条断言都会红。
 * （T04-3 把命名空间从 `patina` 改成 `activity` 时，只翻转这个常量，不要改断言。）
 */
const EXPECTED_NAMESPACE = "patina";
const EXPECTED_EVENT = `${EXPECTED_NAMESPACE}:host-intent`;
const EVENT_LITERAL = /const\s+HOST_INTENT\s*=\s*['"]([^'"]+)['"]/;

function hostIntentLiteral(rel: string, who: string): string {
  const match = EVENT_LITERAL.exec(read(rel));
  expect(match, `${who}里找不到 \`const HOST_INTENT = "…"\``).not.toBeNull();
  return match === null ? "" : match[1];
}

const gatewayEvent = hostIntentLiteral("../../../platform/runtime/activityEvents.ts", "分析窗 ");
const bridgeEvent = hostIntentLiteral("../../../../timing/services/hostIntentBridge.ts", "药丸窗 ");

describe("HOST_INTENT 事件名字面量两侧镜像", () => {
  it("d02g_both_windows_declare_the_identical_event_name_literal", () => {
    expect(gatewayEvent).not.toBe("");
    expect(bridgeEvent).not.toBe("");
    /* 逐字相等：这是本用例存在的全部理由（类型层相等不代表字符串相等）。 */
    expect(bridgeEvent).toBe(gatewayEvent);
  });

  it("d02h_the_event_namespace_is_pinned_in_exactly_one_place", () => {
    /* 命名空间只允许 `EXPECTED_NAMESPACE`，防止三次迁移（patina → 中间态 → activity）中途漂走。 */
    expect(gatewayEvent).toBe(EXPECTED_EVENT);
    expect(bridgeEvent).toBe(EXPECTED_EVENT);
  });
});
