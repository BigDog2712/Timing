/**
 * Timing — 同期电脑活动条（记录面板顶部，Patina 融合的第一处「数据互见」）
 * -----------------------------------------------------------------------------
 * 记录面板回答「我计了多少时」，这条窄条回答「那时候我实际在用什么软件」。
 * 数据来自 Patina 的活动库（宿主只读查询），与 `time_records` 同轴对齐。
 *
 * 三条边界：
 *  ① **没有数据就整条不渲染**（手机端、Patina 库缺失、区间内无采样都一样）——
 *    不留空壳，否则面板上会多出一条看不懂的空行。
 *  ② 只是**旁证**，不参与任何统计，也不可点击：点进去会让人以为能改活动归属。
 *  ③ 单行横向滚动，不换行：记录面板本身是浮层，纵向空间要留给记录明细。
 */
import { formatMinutes } from '../../lib/format';
import type { ActivitySlice } from '../../types/domain';

export function ActivityStrip({ activity }: { activity: ActivitySlice[] }) {
  if (activity.length === 0) return null;

  return (
    <div className="activity-strip" aria-label="同期电脑活动">
      <span className="activity-strip__label">同时在用</span>
      <div className="activity-strip__list">
        {activity.map((slice) => (
          /* 键用「显示名 + 可执行名」：后端按这两列分组，单独用哪个都可能撞。 */
          <span
            key={`${slice.app}|${slice.exe}`}
            className="activity-strip__chip"
            title={`${slice.exe} · ${slice.samples} 段`}
          >
            <span className="activity-strip__app">{slice.app}</span>
            <span className="activity-strip__sec">{formatMinutes(slice.sec)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
