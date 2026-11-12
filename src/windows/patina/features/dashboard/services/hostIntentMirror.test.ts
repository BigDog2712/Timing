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
    expect(gateway).toContain("create_item{isPinned?,name,sortOrder?,timerMinutes?}");
    expect(bridge).toContain("create_item{isPinned?,name,sortOrder?,timerMinutes?}");
    expect(gateway).toContain("update_item{id,isPinned?,name?,sortOrder?,timerMinutes?}");
    expect(bridge).toContain("update_item{id,isPinned?,name?,sortOrder?,timerMinutes?}");
  });
});
