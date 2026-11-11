/**
 * Timing — 同期电脑活动条（记录面板顶部，Patina 融合的第一处「数据互见」）
 * -----------------------------------------------------------------------------
 * 记录面板回答「我计了多少时」，这条窄条回答「那时候我实际在用什么软件」。
 * 数据来自 Patina 的活动库（宿主只读查询），与 `time_records` 同轴对齐。
 *
 * 三条边界：
 *  ① **没有数据就整条不渲染**（手机端、Patina 库缺失、区间内无采样都一样）——
 *    不留空壳，否则面板上会多出一条看不懂的空行。
 *  ② 只**旁证**，不参与任何统计；但自 P0-03 起 chip **可点**：点它 = 去分析窗看
 *    这个应用在这一天的泳道。这里只是「跳过去看」，不改任何归属
 *    （旧注释写「不可点击」，那与现在的行为相反，已改）。没有 `onFocusApp` 时
 *    chip 仍然渲染成按钮但不可聚焦触发动作，形状与文案不变。
 *  ③ 单行横向滚动，不换行：记录面板本身是浮层，纵向空间要留给记录明细。
 */
import { formatMinutes } from '../../lib/format';
import type { ActivitySlice } from '../../types/domain';

interface ActivityStripProps {
  activity: ActivitySlice[];
  /**
   * [P0-03] 点 chip → 去分析窗看这一天（带应用作为聚焦提示）。
   *
   * 传的是**可执行名**（`slice.exe`，如 `Code.exe`）而不是显示名：分析窗活动轨上每段的
   * 身份键是 Patina 归一后的可执行名（`sourceKey`），拿显示名去匹配会静静地不命中
   * （点了 chip、窗也开了，但没有任何段被点亮）。显示名只用于 `title` / `aria-label`。
   */
  onFocusApp?: (exe: string) => void;
}

export function ActivityStrip({ activity, onFocusApp }: ActivityStripProps) {
  if (activity.length === 0) return null;

  return (
    <div className="activity-strip" aria-label="同期电脑活动">
      <span className="activity-strip__label">同时在用</span>
      <div className="activity-strip__list">
        {activity.map((slice) => (
          /* 键用「显示名 + 可执行名」：后端按这两列分组，单独用哪个都可能撞。 */
          <button
            key={`${slice.app}|${slice.exe}`}
            type="button"
            className="activity-strip__chip"
            title={`${slice.exe} · ${slice.samples} 段 · 在分析窗看这一天`}
            aria-label={`在分析窗看 ${slice.app} 这一天的记录`}
            onClick={onFocusApp ? () => onFocusApp(slice.exe) : undefined}
            data-interactive={onFocusApp ? 'true' : undefined}
          >
            <span className="activity-strip__app">{slice.app}</span>
            <span className="activity-strip__sec">{formatMinutes(slice.sec)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
