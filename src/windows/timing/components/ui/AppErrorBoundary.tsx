/**
 * Timing — 渲染异常兜底（V0.4.1 · 0.13 起实现下沉到 `windows/shared`）
 * -----------------------------------------------------------------------------
 * 为什么必须有：主窗是一个 384×360 的**全透明**窗口，小条是它唯一的可见内容
 * （ADR-020 无画布）。React 在渲染期抛错时，React 18+ 的行为是卸载整棵树——
 * 用户看到的是「药丸凭空消失」，而 Rust 侧日志一行都不会有（错误发生在 WebView
 * 里，从不经过 IPC）。这类故障目前只能靠用户口述「它不见了」来复现。
 *
 * 两层防线：
 *   1. `AppErrorBoundary`：拦渲染期异常，**留住一个能点的界面**（可重新加载），
 *      而不是把窗口变成一块看不见的透明区域；
 *   2. `installGlobalErrorHooks`：拦渲染之外的异常（事件回调里的 async 抛错、
 *      Promise 未处理拒绝），走既有的 NoticeBar 提示，不静默吞掉。
 *
 * [0.13 · 主界面第二轮改造] 第 1 层的实现搬到了 `src/windows/shared/AppErrorBoundary.tsx`：
 * 分析窗（patina）此前**完全没有错误边界**，而 L9 不许两窗互相 import，所以只能下沉。
 * 本文件保留原路径与 `installGlobalErrorHooks`，`entry/main.tsx` 一个字符都不用改：
 *   · 类本身是 re-export（缺省文案 = 药丸窗的中文，行为与搬家前逐字一致）；
 *   · 第 2 层留在原地 —— 它要用 `useUiStore`（药丸窗的 store），而下沉到
 *     `windows/shared` 会违反 L10（shared 不得反向依赖任一窗）。
 */
import { useUiStore } from "../../stores/uiStore";

export { AppErrorBoundary, describeBoundaryError } from "../../../shared/AppErrorBoundary.tsx";
export type { AppErrorBoundaryCopy } from "../../../shared/AppErrorBoundary.tsx";

/** 安装全局异常钩子（`main.tsx` 调用一次）。 */
export function installGlobalErrorHooks(): void {
  window.addEventListener("error", (event) => {
    report(event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    report(event.reason);
  });
}

/** 渲染之外的异常：提示条可见 + devtools 可见，不阻断交互。 */
function report(raw: unknown): void {
  const message = describe(raw);
  console.error("[timing] 未捕获异常", raw);
  useUiStore.getState().setNotice({ text: `界面异常：${message}`, tone: "danger" });
}

/** 把任意抛出物压成一行可读文本（超长截断，避免提示条被撑开）。 */
function describe(raw: unknown): string {
  if (raw instanceof Error) return raw.message || raw.name;
  const text = typeof raw === "string" ? raw : String(raw);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
