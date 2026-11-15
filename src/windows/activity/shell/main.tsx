/* [T04-4] 第 1 条 import 必须是存储迁移自举：模块级副作用，保证 24 槽在任何
   store 求值（boardStore.ts:96 的 loadLayout()）与任何渲染之前整批搬完。
   覆盖 profile A 的 activity 窗 + profile B 全部（mini 与通知窗都加载 activity.html）。
   主保证是读写出口里的惰性闸（M-13/M-14），本行是辅助：边界干净、回滚完整。 */
import "../../shared/activityStorageBootstrap";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { iconThemeColorStore } from "../platform/persistence/iconThemeColorStore.ts";
import { configureIconThemeColorPersistence } from "../shared/hooks/useIconThemeColors.ts";

configureIconThemeColorPersistence(iconThemeColorStore);

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
