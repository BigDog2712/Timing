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
 *           `src-tauri/src/app/activity/**` 里 `WINDOW_LABEL|WindowKind::ToolNotification`
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
/** git 在仓库根执行；输出按 UTF-8 文本取。 */
function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

/** T04 基线 commit：本轮开工时 HEAD。8 条「不许碰」路径以它为原点。 */
const T04_BASELINE = "fcbbab5";

/* ── T02 改名适配（目录去 Patina 化） ──────────────────────────────────────
 *
 * T02 把分析窗子树 `src/windows/patina/` → `src/windows/activity/`、后端
 * `src-tauri/src/<层>/insight/` → `.../activity/`，并顺带把 `insight::` 模块路径、
 * `patina_bridge|patina_root|patina_seed` 三个标识符机械改名。
 *
 * 本文件的基线**钉在改名之前的 commit**（fcbbab5），于是同一条逻辑路径在两个
 * treeish 里有两个写法，直接按新路径取基线会 `fatal: exists on disk, but not in 'HEAD'`。
 *
 * 两条适配：
 *   · `preRenamePath` —— 取基线内容时换成旧名路径；
 *   · `preRenameSource` —— 比"零 diff"前把新名规范化回旧名。
 *
 * T02b 追加第三条：`runtime/insightEvents.ts` → `runtime/activityEvents.ts`（同一次
 * 去 Patina 化，只是文件名不在上面两条**目录**规则的覆盖范围内）。被保护清单里的
 * `toolNotificationGateway.ts` 有一行 import 因此改字面，规范化后仍与基线逐字相同。
 *
 * T04 追加第四条（**这是本判据自身的适用范围变化，不是放宽**）：T04 的 mandate 就是
 * 把 label 字面量收敛成常量、把 ACL 文件改名。于是被保护清单里有两条必然被改：
 *   · `app/activity/tool_notifications.rs` —— `"patina"` → `MAIN_WINDOW_LABEL`（+ 一行 import）；
 *   · `capabilities/activity-tool-notification.json` —— identifier/文件名改名 + description
 *     首词去掉旧产品名。
 * 两种都是**机械改名**，同样用规范化吸收；文件里其余任何一个字变化（比如投递链的
 * `Delivery` 映射、`require_current` 的拒绝语义）规范化后仍与基线不同 ⇒ 照样红。
 * 重钉 `T04_BASELINE` 不成立：钉到本批之后，这些"本批就该改"的差异会被当成新基线接受。
 *
 * **判据强度不变**：规范化只把新名映射回旧名，任何真实改动规范化后依旧与基线不同，测试照样红。
 */

/** 新名路径 → 旧名路径（用于向改名前的 treeish 取内容）。 */
const preRenamePath = (p: string): string =>
  p
    .replace(/(src-tauri\/src\/(?:app|commands|infra|models|services)\/)activity(?=\/|$)/g, "$1insight")
    .replace(/src\/windows\/activity(?=\/|$)/g, "src/windows/patina")
    /* T04：capability 文件改名（`patina-tool-notification.json` → `activity-tool-notification.json`）。 */
    .replace(
      /src-tauri\/capabilities\/activity-tool-notification\.json/g,
      "src-tauri/capabilities/patina-tool-notification.json",
    );

/** 源码文本 → 把 T02 的机械改名规范化回旧名（用于与基线逐字比较）。 */
const preRenameSource = (src: string): string =>
  src
    .replace(/((?:\.\.\/)+(?:app|commands|infra|models|services)\/)activity\//g, "$1insight/")
    .replace(/(src-tauri\/src\/(?:app|commands|infra|models|services)\/)activity\//g, "$1insight/")
    .replace(/src\/windows\/activity\//g, "src/windows/patina/")
    .replace(/\bactivity::/g, "insight::")
    .replace(/\bmod activity;/g, "mod insight;")
    .replace(/::activity as\b/g, "::insight as")
    /* T02b：事件名常量文件 `insightEvents.ts` → `activityEvents.ts`（纯文件名改名，
     * 不是目录改名，故不走上面两条规则）。 */
    .replace(/\bactivityEvents\b/g, "insightEvents")
    /* T04：契约面 label 收敛（`"patina"` → `MAIN_WINDOW_LABEL`）。先卸掉那行 import，
     * 再把常量名映射回字面量 —— 顺序不能反（先映射的话 import 行会变成
     * `use …::"patina";`，卸不掉）。
     * ⚠️ 正则要同时认 `activity` 与 `insight`（上面几条先执行，`activity::` 已变 `insight::`）。
     * ⚠️ 只换行内容、留行尾换行（`$` 而非 `;\n\n`）：该 import 紧贴 `mod native;`、后面没空行，
     * 吞掉换行会让「零 diff」因差一个空行而假红。 */
    .replace(/^use crate::app::(?:activity|insight)::main_window::MAIN_WINDOW_LABEL;$/m, "")
    .replace(/\bMAIN_WINDOW_LABEL\b/g, '"patina"')
    /* T04：capability / 入口页改名 + description 首词的旧产品名。 */
    .replace(/\bactivity-tool-notification\b/g, "patina-tool-notification")
    .replace(/\bactivity\.html\b/g, "patina.html")
    .replace(/"description": "工具提醒弹窗/, '"description": "Patina 工具提醒弹窗')
    .replace(/\bactivity_bridge\b/g, "patina_bridge")
    .replace(/\bactivity_root\b/g, "patina_root")
    .replace(/\blegacy_import\b/g, "patina_seed");

/** 探测用：只关心退出码，**吞掉 stderr**（失败是正常路径，不该在 CI 日志里刷 fatal）。 */
function gitOk(args: string[]): boolean {
  try {
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/** 某 treeish 里该路径实际叫什么（HEAD 在 T02 提交前仍是旧名）。 */
const pathIn = (treeish: string, newPath: string): string => {
  const oldPath = preRenamePath(newPath);
  if (oldPath === newPath) return newPath;
  return gitOk(["cat-file", "-e", `${treeish}:${newPath}`]) ? newPath : oldPath;
};

function read(rel: string): string {
  /* 允许调用方写全路径或 patina 相对路径 */
  return readFileSync(join(patinaRoot, rel.replace(/^src\/windows\/activity\//, "")), "utf8");
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
    const source = read("src/windows/activity/shell/types/view.ts");
    expect(source).not.toMatch(/["']tools["']/);
  });

  test("V-2a · buildAppShellViews 没有 tools 键", () => {
    const source = read("src/windows/activity/shell/components/AppShellViews.tsx");
    expect(source).not.toMatch(/^\s*tools:\s*\(/m);
    expect(source).not.toMatch(/features\/tools/);
  });

  test("V-2b · TAB_BY_VIEW 不含 tools", () => {
    const source = read("src/windows/activity/shell/components/AppTopNav.tsx");
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
    const source = read("src/windows/activity/shell/AppShell.tsx");
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

  /** §4.3「不许碰」清单里**整文件零 diff** 的 6 条（另 2 条见下面两个专项测试）。 */
  const WHOLE_FILE_PROTECTED = [
    "src/windows/activity/shell/tool-notification/ToolNotificationShell.tsx",
    "src/windows/activity/platform/runtime/toolNotificationGateway.ts",
    "src-tauri/src/app/activity/tool_notifications.rs",
    "src-tauri/src/app/activity/tool_notifications/native.rs",
    "src-tauri/capabilities/activity-tool-notification.json",
    "src-tauri/src/tests/main_window_profile.rs",
  ];

  test("V-2h · 6 条整文件保护路径相对 T04 基线除 T02 改名外零 diff", () => {
    /* 原判据是 `git diff --name-only <基线> -- <同一组路径>`。T02 改了目录名，同一组路径在基线
     * 提交里根本不存在，`git diff` 于是把它们全报成「新增」。改为：取基线那份的原文，把机械改名
     * 规范化回旧名后与工作树逐字比 —— 判据仍是「整文件零 diff」，只是把改名这层显式化。 */
    const drifted = WHOLE_FILE_PROTECTED.filter((path) => {
      const baseline = git(["show", `${T04_BASELINE}:${preRenamePath(path)}`]);
      const working = readFileSync(join(repoRoot, path), "utf8");
      return preRenameSource(working) !== baseline;
    });
    expect(drifted).toEqual([]);
  });

  test("V-2h · webview_recovery.rs 的 ToolNotification 分支行与基线逐字相同", () => {
    /* enum 成员与 `:317/:323/:379` 三个分支一个字节不许动。基线里第 4 行是 `:225` 那处**内联
     * label 映射** —— T04-2 搬进了 `window_labels.rs::label()`，故从基线侧剔掉；映射仍在、且
     * 一一对应，由下面计数判据的「基线 +3」钉住（删任何一个 `=>` 分支都会掉）。另外改判**工作树**
     * 而不是 `HEAD`：原来比 `at("HEAD")`，在提交之前那次比较是空的（HEAD 里还没变）。 */
    const REL = "src-tauri/src/app/activity/webview_recovery.rs";
    const lines = (source: string) => source.split("\n").filter((line) => line.includes("ToolNotification"));
    const working = lines(readFileSync(join(repoRoot, REL), "utf8"));
    const baseline = lines(git(["show", `${T04_BASELINE}:${preRenamePath(REL)}`]))
      .filter((line) => !line.includes("match kind {"));
    expect(preRenameSource(working.join("\n"))).toBe(baseline.join("\n"));
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

  /* [T04 修订] 判据从「与基线相等」改为「等于基线 + 已知偏移」；三处口径变化都不是放宽：
   * 1. **词边界**（`-F` → `-E` + `\b`）：本批新增 `MINI_WINDOW_LABEL`，它包含 `WINDOW_LABEL`
   *    子串 —— 定长子串数会把新常量数进去（实测 21 → 60），判据当场假红。
   * 2. **`--untracked`**：本批新增映射表 `window_labels.rs`，而 `git grep` 默认只扫已跟踪文件
   *    —— 不带则命中数随「有没有 git add」跳变。带上反而**更严**：不带就能靠"留个未跟踪的
   *    新文件"绕过判据。
   * 3. **+3 是已知偏移**：`window_labels.rs` 新增 4 处（`WindowKind::ALL` 1 + `label()` 分支 2
   *    + 文档注释点名 1），`webview_recovery.rs` 少 1 处（`match kind {…}` 内联映射搬走）。
   *    写成常量而非删判据：**再加一个窗类型，偏移就超过 3 ⇒ 照样红**。
   *    （label 值一致性由第 9 步 `check:runtime-ids` 的 a/b/c 覆盖，比词频更准。） */
  test("V-2h · 分析窗后端子树的 WINDOW_LABEL|WindowKind::ToolNotification 计数为基线 +3", () => {
    /* 目录名在 T02 变了（旧 `insight` / 新 `activity`），基线按旧目录数、工作树按新目录数。 */
    const REL_DIR = "src-tauri/src/app/activity";
    const WINDOW_KIND_MAPPING_SITES = 3;
    const count = (treeish: string | null) => {
      const args = ["grep", "-o", "-E", "-e", "\\bWINDOW_LABEL\\b|WindowKind::ToolNotification"];
      /* 基线是 commit（已跟踪全集）；工作树连未跟踪文件一起数（见上第 2 条）。 */
      args.push(treeish ?? "--untracked");
      args.push("--", treeish ? pathIn(treeish, REL_DIR) : REL_DIR);
      return git(args).split("\n").filter((line) => line.length > 0).length;
    };
    expect(count(null)).toBe(count(T04_BASELINE) + WINDOW_KIND_MAPPING_SITES);
  });
});
