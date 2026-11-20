/**
 * 「标签拖动改分类能用」的宿主侧前提（源码哨兵）
 * -----------------------------------------------------------------------------
 * 这条链断起来是**完全静默**的：Tauri 在 Windows 上默认接管 WebView2 的拖放
 * （`dragDropEnabled: true`，用来发 `DragDropEvent`），页面里的 HTML5 拖拽就被吞掉
 * —— `dragstart` 根本不触发，没有报错、没有提示，只是"拖不动"。
 *
 * 所以两处必须同时成立，缺一处的症状一模一样：
 *   ① conf 里 `main` 窗口（小条）要 `dragDropEnabled: false`；
 *   ② 程序化创建的 activity 主窗口（标签管理所在的那个）要在 builder 上调
 *      `disable_drag_drop_handler()` —— 它根本不读 conf 的窗口项。
 *
 * 判据读**剥掉注释**的代码：文件头注释里必须留着"为什么关掉"的说明，其中就写着
 * 这个函数名；不剥注释的话，删掉真正的调用也照样全绿。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from "node:path";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** `src/windows/activity/features/data/components/` → 仓库根（上溯六级） */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("标签拖动改分类 · 宿主不许吞掉 HTML5 拖拽", () => {
  it("conf 的小条窗口关掉了 Tauri 的拖放处理器", () => {
    const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as {
      app: { windows: { label: string; dragDropEnabled?: boolean }[] };
    };
    const pill = conf.app.windows.find((window) => window.label === "main");
    expect(pill, "conf 里找不到 label=main 的窗口").toBeTruthy();
    expect(
      pill?.dragDropEnabled,
      "dragDropEnabled 不是 false：WebView2 的 HTML5 拖拽会被 Tauri 吞掉（拖动改分类、小条排序都会拖不动）",
    ).toBe(false);
  });

  it("activity 主窗口的 builder 调了 disable_drag_drop_handler", () => {
    const rust = stripComments(
      readFileSync(join(ROOT, "src-tauri/src/app/activity/main_window.rs"), "utf8"),
    );
    expect(
      rust,
      "main_window.rs 里的 WebviewWindowBuilder 少了 disable_drag_drop_handler()：程序化窗口不读 conf，标签管理的拖动会静默失效",
    ).toContain(".disable_drag_drop_handler()");
  });
});