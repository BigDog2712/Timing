import { lazy, Suspense, useEffect } from "react";
import "./App.css";
import AppShell from "./AppShellLocaleRoot";
import { AppErrorBoundary } from "../../shared/AppErrorBoundary.tsx";
import { installAppIconEvents } from "../platform/runtime/appIconEventGateway.ts";
import { resolveCurrentAppWindowLabel } from "../platform/desktop/windowControlGateway";

const CURRENT_WINDOW_LABEL = resolveCurrentAppWindowLabel();
const MiniShell = lazy(() => import("./mini/MiniShell"));
const ToolNotificationShell = lazy(() => import("./tool-notification/ToolNotificationShell"));

if (import.meta.env.DEV && CURRENT_WINDOW_LABEL === "main") {
  void import("./services/resourceDiagnosticsService.ts")
    .then(({ installAppDevelopmentResourceDiagnostics }) => {
      installAppDevelopmentResourceDiagnostics();
    })
    .catch((error: unknown) => {
      console.warn("install development resource diagnostics failed", error);
    });
}

if (typeof document !== "undefined") {
  document.documentElement.dataset.windowLabel = CURRENT_WINDOW_LABEL;
  document.body?.setAttribute("data-window-label", CURRENT_WINDOW_LABEL);
  document.getElementById("root")?.setAttribute("data-window-label", CURRENT_WINDOW_LABEL);
}

export default function App() {
  useEffect(installAppIconEvents, []);
  /* [0.13 · 1.2] `mini` 窗也要有边界：它是"缩小版主界面"，同样会因渲染期异常整树卸载，
   * 表现是「小窗凭空消失」。文案走缺省（中文）—— 这一层在 `MiniShell` 的 LocaleProvider
   * **之外**，拿不到 locale；窗内还有一层按 locale 取文案的边界（`MiniShell.tsx`）。
   * `tool-notification` 窗本轮不动（T04 下线时一起处理）。 */
  if (CURRENT_WINDOW_LABEL === "mini") {
    return (
      <AppErrorBoundary>
        <Suspense fallback={null}>
          <MiniShell />
        </Suspense>
      </AppErrorBoundary>
    );
  }
  return <Suspense fallback={null}>
    {CURRENT_WINDOW_LABEL === "tool-notification" ? <ToolNotificationShell /> : <AppShell />}
  </Suspense>;
}
