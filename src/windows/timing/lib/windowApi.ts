/**
 * Timing — 窗口 API 薄壳（纯 re-export，零业务依赖）
 * -----------------------------------------------------------------------------
 * 存在的理由：`src/lib/window.ts` 是全仓唯一的窗口 API 出口，但它同样 `import
 * '../services/ipc'`——分析窗（`src/platform/desktop/windowControlGateway.ts`）直接
 * 复用它，会把宿主 IPC 全表 + browserMock 拖进分析窗 bundle。
 *
 * 所以这里只做转发：不 import 任何业务模块、不读 `window`/`document`、无副作用。
 * L3 的判据（`npm run check` 的 check:layers）要求 `@tauri-apps/api/window` 与
 * `@tauri-apps/api/webviewWindow` **只出现在本文件**（T04 起 `window.ts` 也改为经此转出）。
 */
export { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
export type { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
export { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
