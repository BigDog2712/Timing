/**
 * md 覆盖提醒（T03）· 跨端一致性判据
 * -----------------------------------------------------------------------------
 * 这条链上每一环都能单独通过、合起来失效，而且失效时**屏幕上什么都不会说**：
 *
 *   Rust `Decision::as_str()`  ──写进审计表的字──┐
 *   前端 `Decision` 联合类型    ──点了按钮传来的字──┤ 两处对不上 ⇒ serde 解析失败，红字一闪
 *   Rust `ConflictState` serde  ──弹窗载荷里的 state─┤ 对不上 ⇒ 弹窗永不出现
 *   前端 `ConflictState`        ──过滤条件───────┘
 *
 *   事件名 `MD_SYNC_DECISION_REQUIRED`（Rust 常量） ↔ `MD_SYNC_DECISION_REQUIRED_EVENT`（TS 常量）
 *   对不上 ⇒ 前台同步检测到冲突，但没有任何人监听 ⇒ 静默按「保留文件」继续，用户完全不知情。
 *
 * 所以这组断言钉的是**字符串字面量逐字相等**，不是「两边都有个常量」。
 * 类型检查抓不住它：两侧的类型各自自洽，错的是一个单词。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { dirname, join } from "node:path";
// @ts-expect-error 同上：仅测试进程用得到 node:url。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* 本文件在 `src/windows/activity/features/settings/components/host/`：七级上去是仓库根。
   ⚠ 不用 `new URL(<字面量>, import.meta.url)`：vite 会把字面量形态静态重写成 dev-server URL
   （记忆里那条「Vite 静态改写 new URL ⇒ fs.readFileSync 报 scheme 错」）。 */
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

/** 去掉 `//` 与块注释：注释里出现「见 xxx」不算接线（本仓的既有纪律）。 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const RUST_EVENTS = "src-tauri/src/app/events.rs";
const RUST_MODELS = "src-tauri/src/models/md_sync.rs";
const RUST_DECISION = "src-tauri/src/services/md_sync/decision.rs";
const RUST_CMD = "src-tauri/src/commands/md_sync_cmd.rs";
const TS_EVENTS = "src/windows/activity/features/settings/services/host/hostEvents.ts";
const TS_TYPES = "src/windows/shared/dto/hostTypes.ts";
const DIALOG =
  "src/windows/activity/features/settings/components/host/MdSyncDecisionDialog.tsx";
const PANEL = "src/windows/activity/features/settings/components/host/HostSyncPanel.tsx";

describe("t · T03 跨端字面量一致", () => {
  it("t01_event_name_is_字面量相等 on both sides", () => {
    const rust = stripComments(read(RUST_EVENTS));
    expect(rust).toContain('pub const MD_SYNC_DECISION_REQUIRED: &str = "md-sync:decision-required";');

    const ts = stripComments(read(TS_EVENTS));
    expect(ts).toContain('export const MD_SYNC_DECISION_REQUIRED_EVENT = "md-sync:decision-required";');
    expect(stripComments(read(DIALOG))).toContain("MD_SYNC_DECISION_REQUIRED_EVENT");
  });

  it("t02_decision_vocabulary_matches_rust_as_str", () => {
    const rust = stripComments(read(RUST_MODELS));
    for (const word of ["overwrite_timing", "keep_timing", "deferred"]) {
      expect(rust, `Rust 侧缺词汇 ${word}`).toContain(`"${word}"`);
    }
    const ts = stripComments(read(TS_TYPES));
    expect(ts).toContain(
      "export type Decision = 'overwrite_timing' | 'keep_timing' | 'deferred';",
    );

    /* 三个按钮各发一个词：少一个就是「某个按钮点了没反应」。 */
    const dialog = stripComments(read(DIALOG));
    for (const word of ["overwrite_timing", "keep_timing", "deferred"]) {
      expect(dialog, `弹窗没有发 ${word}`).toContain(`"${word}"`);
    }
  });

  it("t03_conflict_state_vocabulary_matches_rust_serde", () => {
    const rust = stripComments(read(RUST_DECISION));
    expect(rust, "ConflictState 必须 snake_case 序列化").toContain('#[serde(rename_all = "snake_case")]');
    const ts = stripComments(read(TS_TYPES));
    expect(ts).toContain("'awaiting_decision' | 'pending_decision'");
    /* 弹窗只认 awaiting：写错成 `awaiting` 就永远不弹。 */
    expect(stripComments(read(DIALOG))).toContain('const AWAITING = "awaiting_decision";');
  });

  it("t04_front_sync_announces_decisions_on_both_platforms", () => {
    /* 桌面与手机各一份命令层：只接一边 = 另一边永远不弹窗（手机端尤其难察觉）。 */
    for (const file of [RUST_CMD, "src-tauri/src/commands/md_sync_cmd_mobile.rs"]) {
      const code = stripComments(read(file));
      expect(code, `${file} 没有提升待裁决`).toContain("decision::promote_all()");
      expect(code, `${file} 没有广播裁决事件`).toContain("emit_md_sync_decision_required");
      expect(code, `${file} 的提示必须挂在手动同步之后`).toContain("announce_decisions(&app)");
    }
  });

  it("t05_dialog_is_mounted_in_the_sync_panel", () => {
    /* 组件写好了但没挂上去 = 一整轮白做，而且测试与类型检查都不会红。 */
    const panel = stripComments(read(PANEL));
    expect(panel).toContain("<MdSyncDecisionDialog />");
    expect(panel).toContain("import { MdSyncDecisionDialog }");
  });
});
