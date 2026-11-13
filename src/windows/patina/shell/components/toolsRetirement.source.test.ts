/**
 * [本轮 T04] 工具页下线的**替代判据**（V-2a / V-2b / V-2c / V-2d / V-2g / V-2h）。
 *
 * 原 `features/tools/services/timingSemantics.test.ts` 的判据对象（专注组件四件 +
 * 「工具页挂上了状态行」）整批删除了，判据换窄 —— 换，不是删（设计 §4.3 / T04）：
 *   · V-2a  `View` 联合与 `buildAppShellViews` 的返回对象不再含 `tools`；
 *   · V-2b  `AppTopNav.TAB_BY_VIEW` 不含 tools；
 *   · V-2c  活动提醒卡的组件目录 0 处传输层调用（写动作全走 `useActivityReminders`）；
 *   · V-2d  `ToolAlertDialog` 仍挂在 `AppShell`（活动提醒到点要弹）；
 *   · V-2g  ① shell/** 与 features/dashboard/** 里灯簇四名零命中；
 *           ② features/tools/** 剩余文件的相对 import 全部可解析（防"删了父、留了子"）；
 *           ③ shell/mini/** 对 features/tools 的 import 为 0。
 *   · V-2h  Q4 = (A) 的守门判据：8 条「不许碰」路径相对 T04 基线零 diff；
 *           `src-tauri/src/app/insight/**` 里 `WINDOW_LABEL|WindowKind::ToolNotification`
 *           计数与基线相等（§4.3 / §6）。
 *
 * 这类判据按**源码文本**扫描（仓里已有 `useThemeWiring.source.test.ts` 先例）：
 * 门禁关心的是"这些名字在这些目录里不存在"，跑组件树反而测不到"孤儿 import"。
 */
import { describe, expect, test } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { execFileSync } from "node:child_process";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync, readdirSync, statSync } from "node:fs";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from "node:path";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from "node:url";

/* 全部路径以 patina 为根（本文件在 patina/shell/components/ 下，两级出去就是 patina）。
 * ⚠ 不用 `new URL(<字面量>, import.meta.url)`：vite 会把字面量形态静态重写成 dev-server
 * URL（http://），fs 一律拒绝。先 fileURLToPath 再 join 是仓里的既有写法。 */
const patinaRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/* 仓库根（再上三级：patina → windows → src）。V-2h 的 git 命令都在这里跑。 */
const repoRoot = join(patinaRoot, "..", "..", "..");
/** T04 基线 commit：本轮开工时 HEAD。8 条「不许碰」路径以它为原点。 */
const T04_BASELINE = "fcbbab5";

function read(rel: string): string {
  /* 允许调用方写全路径或 patina 相对路径 */
  return readFileSync(join(patinaRoot, rel.replace(/^src\/windows\/patina\//, "")), "utf8");
}

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(join(patinaRoot, dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(patinaRoot, p), { throwIfNoEntry: false })?.isDirectory()) walk(p, exts, out);
    else if (exts.some((ext) => name.endsWith(ext))) out.push(p);
  }
  return out;
}

const shellFiles = walk("shell", [".ts", ".tsx"]);
const dashboardFiles = walk("features/dashboard", [".ts", ".tsx"]);
const toolsFiles = walk("features/tools", [".ts", ".tsx"]);
const miniFiles = shellFiles.filter((f) => f.includes("/shell/mini/"));
const reminderFiles = walk("features/dashboard/components/reminder", [".tsx"]);

describe("[T04] 工具页下线判据", () => {
  test("V-2a · View 联合不再含 tools", () => {
    const source = read("src/windows/patina/shell/types/view.ts");
    expect(source).not.toMatch(/["']tools["']/);
  });

  test("V-2a · buildAppShellViews 没有 tools 键", () => {
    const source = read("src/windows/patina/shell/components/AppShellViews.tsx");
    expect(source).not.toMatch(/^\s*tools:\s*\(/m);
    expect(source).not.toMatch(/features\/tools/);
  });

  test("V-2b · TAB_BY_VIEW 不含 tools", () => {
    const source = read("src/windows/patina/shell/components/AppTopNav.tsx");
    expect(source).not.toMatch(/tools:\s*["']/);
  });

  test("V-2c · 活动提醒卡组件目录零传输层调用", () => {
    expect(reminderFiles.length).toBeGreaterThan(0);
    for (const file of reminderFiles) {
      expect(file).toMatch(/\/reminder\/.+\.tsx$/);
      const source = read(file);
      expect(source).not.toMatch(/\binvoke\(/);
      expect(source).not.toMatch(/\bipc\./);
    }
  });

  test("V-2d · ToolAlertDialog 仍挂在 AppShell", () => {
    const source = read("src/windows/patina/shell/AppShell.tsx");
    expect(source).toMatch(/<ToolAlertDialog\s*\/>/);
  });

  test("V-2g ① · 灯簇四名在 shell 与 dashboard 零命中", () => {
    const lamp = /ToolsStatusEntry|ToolStatusButtons|toolStatusEntries|MiniToolStatus/;
    /* 本判据文件自己会字面写出这四个名字 —— 它是判官，不进被告席 */
    for (const file of [...shellFiles, ...dashboardFiles]
      .filter((f) => !f.endsWith("toolsRetirement.source.test.ts"))) {
      // 灯簇四名零命中：连注释里都不许出现（删一半留一半最常藏在注释里）
      expect(lamp.test(read(file)) ? `${file} still mentions the lamp cluster` : null).toBeNull();
    }
  });

  test("V-2g ② · features/tools 剩余文件的相对 import 全部可解析", () => {
    expect(toolsFiles.length).toBeGreaterThan(0);
    for (const file of toolsFiles) {
      const source = read(file);
      const specs = [...source.matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)]
        .map((match) => match[1]);
      const dirPath = dirname(join(patinaRoot, file));
      for (const spec of specs) {
        const target = join(dirPath, spec);
        const exists = [".ts", ".tsx", ".css", "/index.ts", "/index.tsx"]
          .some((ext) => statSync(target + ext, { throwIfNoEntry: false })?.isFile() === true)
          || statSync(target, { throwIfNoEntry: false })?.isFile() === true;
        expect(`${file} -> ${spec}`).toBe(exists ? `${file} -> ${spec}` : `missing: ${file} -> ${spec}`);
      }
    }
  });

  test("V-2g ③ · mini 窗不再引 features/tools", () => {
    for (const file of miniFiles) {
      expect(read(file)).not.toMatch(/features\/tools/);
    }
  });
});

describe("[T04] V-2h · tool-notification 投递链守门（Q4 = (A)）", () => {
  /** git 在仓库根执行；输出按 UTF-8 文本取。 */
  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  }

  /** §4.3「不许碰」清单里**整文件零 diff** 的 6 条（另 2 条见下面两个专项测试）。 */
  const WHOLE_FILE_PROTECTED = [
    "src/windows/patina/shell/tool-notification/ToolNotificationShell.tsx",
    "src/windows/patina/platform/runtime/toolNotificationGateway.ts",
    "src-tauri/src/app/insight/tool_notifications.rs",
    "src-tauri/src/app/insight/tool_notifications/native.rs",
    "src-tauri/capabilities/patina-tool-notification.json",
    "src-tauri/src/tests/main_window_profile.rs",
  ];

  test("V-2h · 6 条整文件保护路径相对 T04 基线零 diff", () => {
    const changed = git(["diff", "--name-only", T04_BASELINE, "--", ...WHOLE_FILE_PROTECTED]).trim();
    expect(changed).toBe("");
  });

  test("V-2h · webview_recovery.rs 的 ToolNotification 行与基线逐字相同", () => {
    /* 设计允许该文件因别的原因被改，但六个 `WindowKind::ToolNotification` 点
     *（:21 enum 成员 + :169/:225/:317/:323/:379 五处分支）一个字节不许动 ——
     * 所以这里不判整文件，只判含该标识符的行集合。 */
    const at = (treeish: string) => git(["show", `${treeish}:src-tauri/src/app/insight/webview_recovery.rs`])
      .split("\n").filter((line) => line.includes("ToolNotification")).join("\n");
    expect(at("HEAD")).toBe(at(T04_BASELINE));
  });

  test("V-2h · window-commands.toml 的 tool-notification-commands 段与基线逐字相同", () => {
    /* 本轮 T03 等任务可能动该文件的其他段（如 patina-todo-notes）；保护的只有
     * `[[permission]] identifier = "tool-notification-commands"` 这一段（不是 TOML 表头）。
     * 注意真实路径是 `src-tauri/permissions/`，设计文档写的 `src-tauri/src/permissions/`
     * 多了一层 `src`（已报告）。 */
    const section = (source: string) => {
      const lines = source.split("\n");
      const start = lines.findIndex((line) => line.trim() === 'identifier = "tool-notification-commands"');
      expect(start).toBeGreaterThanOrEqual(0);
      /* 段体向上含 `[[permission]]` 头、向下到下一个 `[[permission]]`（或文件尾） */
      let head = start;
      while (head > 0 && lines[head].trim() !== "[[permission]]") head -= 1;
      let end = start + 1;
      while (end < lines.length && lines[end].trim() !== "[[permission]]") end += 1;
      return lines.slice(head, end).join("\n");
    };
    const baseline = git(["show", `${T04_BASELINE}:src-tauri/permissions/window-commands.toml`]);
    const working = readFileSync(join(repoRoot, "src-tauri/permissions/window-commands.toml"), "utf8");
    expect(section(working)).toBe(section(baseline));
  });

  test("V-2h · insight/** 的 WINDOW_LABEL|WindowKind::ToolNotification 计数与基线相等", () => {
    const count = (treeish: string | null) => {
      const args = ["grep", "-o", "-F", "-e", "WINDOW_LABEL", "-e", "WindowKind::ToolNotification"];
      if (treeish) args.push(treeish);
      args.push("--", "src-tauri/src/app/insight");
      return git(args).split("\n").filter((line) => line.length > 0).length;
    };
    expect(count(null)).toBe(count(T04_BASELINE));
  });
});
