import { useLocaleText } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AppWindow, ArrowUpCircle, Maximize2, Minimize2, Minus, X } from "lucide-react";
import { openMiniWindow } from "../../platform/desktop/miniWindowRuntimeGateway.ts";
import appIconUrl from "../../../src-tauri/icons/128x128@2x.png";
import {
  closeCurrentWindow, minimizeCurrentWindow, toggleCurrentWindowMaximized, } from "../../platform/desktop/windowControlGateway";
import { useWindowDragGesture } from "../../shared/hooks/useWindowDragGesture.ts";


const APP_TITLE = "Timing";

type AppTitleBarProps = {
  isMaximized: boolean;
  showUpdateEntry?: boolean;
  onOpenUpdateDialog?: () => void;
  toolsStatusEntry?: ReactNode;
  /** [P0-04] 「Timing 计时胶囊」槽位。药丸在计时时由 `TimingCapsule` 填，其它时候为 null */
  timingStatusEntry?: ReactNode;
  /** ③ tab 段槽位（01 §3.1）。由 `AppTopNav` 填；本组件只负责给它一个 flex 槽，
   *  不关心它是导航还是别的 —— navItems 不进本组件（顶栏组件不该知道"有哪些区"）。 */
  navigationSlot?: ReactNode;
};

function runWindowAction(action: () => Promise<void>, actionName: string) {
  void action().catch((error) => {
    console.warn(`${actionName} failed`, error);
  });
}

export default function AppTitleBar({
  isMaximized,
  showUpdateEntry = false,
  onOpenUpdateDialog,
  toolsStatusEntry,
  timingStatusEntry,
  navigationSlot,
}: AppTitleBarProps) {
  const UI_TEXT = useLocaleText();
  const [miniBusy, setMiniBusy] = useState(false);
  const [miniFailed, setMiniFailed] = useState(false);
  const openingMini = useRef(false);
  const miniEntry = useRef<HTMLButtonElement>(null);
  const restoreMiniFocus = useRef(false);
  useEffect(() => {
    if (miniBusy || !miniFailed || !restoreMiniFocus.current) return;
    restoreMiniFocus.current = false;
    if (document.activeElement === document.body) miniEntry.current?.focus({ preventScroll: true });
  }, [miniBusy, miniFailed]);
  const handleOpenMini = async () => {
    if (openingMini.current) return;
    openingMini.current = true;
    restoreMiniFocus.current = document.activeElement === miniEntry.current;
    setMiniBusy(true);
    setMiniFailed(false);
    try { await openMiniWindow(); }
    catch (error) { setMiniFailed(true); console.warn("mini:open", error); }
    finally { openingMini.current = false; setMiniBusy(false); }
  };
  /* [v3.1 拖窗] 原来只有 brand 右边那条 96px 的 `.app-titlebar-drag-region` 挂着
   * mousedown → startDragging，表现就是「窗口只有左上能拖」。现在整条标题栏都能拖：
   * 判据是「按下的是不是控件」——按钮 / 输入框 / 链接 / 标了 data-no-drag 的子树
   * 一律不拖（否则点最小化键会被当成拖窗口）。
   * 用 `useWindowDragGesture`（分析窗自己的版本，见该文件头）而不是
   * `data-tauri-drag-region`：后者只认命中自己的那个元素，子元素上的点击一律不生效，
   * 等于没修。 */
  const windowDrag = useWindowDragGesture();
  const isInteractive = (target: EventTarget | null) => (
    target instanceof Element
    && target.closest("button, a, input, textarea, select, [data-no-drag]") !== null
  );

  const handleBarPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (isInteractive(event.target)) return;
    windowDrag.onPointerDown(event);
  };

  const handleBarDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (isInteractive(event.target)) return;
    runWindowAction(toggleCurrentWindowMaximized, "toggle window maximize");
  };

  return (
    <header
      className="app-titlebar"
      aria-label={APP_TITLE}
      onPointerDown={handleBarPointerDown}
      onClickCapture={windowDrag.onClickCapture}
      onDoubleClick={handleBarDoubleClick}
    >
      <div className="app-titlebar-brand">
        <span className="app-titlebar-mark" aria-hidden>
          <img className="app-titlebar-icon" src={appIconUrl} alt="" draggable={false} />
        </span>
        <span className="app-titlebar-name">{APP_TITLE}</span>
      </div>

      {/* 96px 的留白段：拖窗热区已经覆盖整条标题栏，这里只负责品牌段与 tab 段之间的呼吸 */}
      <div className="app-titlebar-drag-region" aria-hidden />

      {navigationSlot}

      {/* ④ status 段：吸收五段配平剩下的全部宽度（1100 档 486 / 900 档 322）。
          更新入口从"brand 之后、drag 之前"挪到这里 —— ① brand 必须锁死 114、
          ② drag 锁死 96，更新入口留在原处会把 brand 段撑宽（01 §3.1）。 */}
      <div className="qp-topbar-status" data-titlebar-status="">
        {timingStatusEntry}
        {showUpdateEntry ? (
          <button
            type="button"
            className="app-titlebar-update-entry"
            data-titlebar-update-entry=""
            onClick={onOpenUpdateDialog}
          >
            <ArrowUpCircle size={12} strokeWidth={1.9} aria-hidden="true" />
            <span>{UI_TEXT.update.sidebarEntry}</span>
          </button>
        ) : null}
        {toolsStatusEntry}
      </div>

      <div className="app-titlebar-controls">
        <button ref={miniEntry} type="button" className="app-titlebar-button" data-titlebar-mini-entry=""
          aria-label={UI_TEXT.miniWindow.open} aria-busy={miniBusy} disabled={miniBusy}
          onClick={() => { void handleOpenMini(); }}><AppWindow size={14} strokeWidth={1.8} /></button>
        {miniFailed && <span className="app-titlebar-mini-error" role="alert">{UI_TEXT.miniWindow.failed}</span>}
        <button
          type="button"
          className="app-titlebar-button"
          aria-label={UI_TEXT.accessibility.titleBar.minimize}
          onClick={() => runWindowAction(minimizeCurrentWindow, "minimize current window")}
        >
          <Minus size={14} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          className="app-titlebar-button"
          aria-label={isMaximized ? UI_TEXT.accessibility.titleBar.restore : UI_TEXT.accessibility.titleBar.maximize}
          onClick={() => runWindowAction(toggleCurrentWindowMaximized, "toggle window maximize")}
        >
          {isMaximized ? (
            <Minimize2 size={14} strokeWidth={2} />
          ) : (
            <Maximize2 size={14} strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          className="app-titlebar-button app-titlebar-close"
          aria-label={UI_TEXT.accessibility.titleBar.close}
          onClick={() => runWindowAction(closeCurrentWindow, "close current window")}
        >
          <X size={14} strokeWidth={2.1} />
        </button>
      </div>
    </header>
  );
}
