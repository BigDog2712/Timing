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
const bridge = extractIntents(read("../../../services/hostIntentBridge.ts"));

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
});
