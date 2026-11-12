/**
 * Timing — 「今天」/「今日摘要」动作（P0-03 · P1-02 的统一出口）
 * -----------------------------------------------------------------------------
 * 四个动作都放在服务层而不是组件里：L1 门禁不许 `src/components` 出现 `ipc.`（ADR-017）。
 *
 *  ① `openTodayPanel()` / ② `openDigestPanel()`：打开 `records` / `digest` 面板（药丸左键、
 *     药丸右键、记录面板头部按钮）。此前 `openPanel('records')` 全仓 **0 处调用**——「同时在
 *     用」这条唯一的融合可见物在 UI 上根本没有入口。
 *  ③ `openTodayInAnalysis(focusApp?)` / ④ `openOverviewInAnalysis()`：把「今天」/「总览」递给
 *     分析窗，走宿主命令 `open_patina_window` 的**可选落点**参数（命令名与条数不变）；Rust
 *     侧先写 pending 状态再 show，所以**冷启动（分析窗还没创建）也能落到指定页**。
 *
 * 失败口径（FUSION-ARCH-v1 §6.5）：窗没就绪不算错误（Rust 只 `log_warn`，用户再点一次就
 * 好）；但 invoke 本身的失败（ACL / 序列化 / 运行时缺失）**不能静默吞掉**——落一条危险提示，
 * 用户有「再点一次」这个可重试动作。乱跳日期比报错更难排查。
 */
import { todayDateKey } from '../lib/dateKey';
import { useUiStore } from '../stores/uiStore';
import { errorText, ipc } from './ipc';

/** 打开记录面板（药丸「今天」左键的落点）。 */
export function openTodayPanel(): void {
  useUiStore.getState().openPanel('records');
}

/** 打开今日摘要面板（P1-02 E1 记录面板头部 / E2 药丸右键的落点）。 */
export function openDigestPanel(): void {
  useUiStore.getState().openPanel('digest');
}

/** 打不开分析窗时的唯一提示（窗没就绪不算错，只有 invoke 失败才走到这里）。 */
function warnOpenFailed(err: unknown): void {
  useUiStore.getState().setNotice({ text: `没能打开分析窗，请再点一次。（${errorText(err)}）`, tone: 'danger' });
}

/**
 * 在分析窗里看「今天」。
 * @param focusApp 可选的聚焦应用名（记录面板「同时在用」chip 带的旁证）。值由分析窗
 *   `History` 侧派生为高亮键（`highlightSourceKey`）；**不为聚焦新增命令或事件**，仍然只走
 *   `open_patina_window` 这一个既有可选落点。
 */
export async function openTodayInAnalysis(focusApp: string | null = null): Promise<void> {
  try {
    await ipc.openPatinaWindow({ target: { history: { dateKey: todayDateKey(), focusApp } } });
  } catch (err) {
    warnOpenFailed(err);
  }
}

/** 在分析窗里看「总览」（P1-02 E4）：不带日期、不带聚焦，只把分析窗切到总览页。 */
export async function openOverviewInAnalysis(): Promise<void> {
  try {
    await ipc.openPatinaWindow({ target: { overview: true } });
  } catch (err) {
    warnOpenFailed(err);
  }
}
