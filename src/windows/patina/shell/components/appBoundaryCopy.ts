/**
 * 分析窗（patina）的错误边界文案 —— **四语言齐备**。
 *
 * 为什么不进 `shared/i18n/**`：那四个 locale 文件是**按索引对齐的位置数组**，
 * 手插一行会让其后全部文案错位（`generated/contract.ts` 还在 size-allowlist 里冻结着）。
 * 同 `boardCopy.ts` / `copyTimeline.ts` 的纪律：窗内自有表，**四键齐全**，
 * ru / es 不许静默降级成英文。
 *
 * 为什么需要这三句：渲染期一抛异常，React 会卸载整棵根树，`#root` 变空 →
 * 露出 WebView 的深色底（「全黑」）+ 导航随树消失（「无法返回」）。兜底面板是
 * 用户唯一的出口，所以它必须说人话，而不是把一段英文栈甩在中文界面里。
 */
import type { Locale } from "../../shared/i18n/index.ts";
import type { AppErrorBoundaryCopy } from "../../../shared/AppErrorBoundary.tsx";

export const APP_BOUNDARY_COPY: Record<Locale, AppErrorBoundaryCopy> = {
  "zh-CN": {
    title: "这块内容加载失败了",
    reload: "重新加载",
    backHome: "回到主界面",
  },
  "en-US": {
    title: "This section failed to load",
    reload: "Reload",
    backHome: "Back to dashboard",
  },
  "ru-RU": {
    title: "Не удалось загрузить этот раздел",
    reload: "Перезагрузить",
    backHome: "Вернуться на главный экран",
  },
  es: {
    title: "No se pudo cargar esta sección",
    reload: "Recargar",
    backHome: "Volver al inicio",
  },
};
