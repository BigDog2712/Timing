/**
 * 把后端算好的「逐桶并集」摊到展示窗口上（纯函数，零 IO）。
 *
 * 为什么需要这一层：查询用的桶边界与展示用的窗口**不是同一组**。
 *   · 趋势卡：`query.boundaries` 裁到此刻（后端要求 `边界末 == endMs`），而展示轴恒 24 个整点；
 *   · 热力图：今天最后一格被裁到此刻，其余格是整小时。
 * 所以最后一个窗口往往只是某个桶的**前半截**，直接取整桶的值会把"还没发生的时间"算进去
 * ——那正是老实现里"末窗口右端裁到此刻"要避免的那个读数错误。
 *
 * 摊法：按窗口与桶的真实交集长度**等比**分配。整桶被覆盖时就是原值（不引入浮点误差），
 * 只有被裁的那一格才做除法，结果四舍五入到毫秒（读数是整数毫秒，前端不做亚毫秒）。
 *
 * 为什么不等比分配之外还要"按交集裁剪"：DST 前跳日少一个桶，此时窗口与桶会错位半格，
 * 硬按序号对齐会让整条轴从那一格起全部偏移一小时。
 */
export interface BucketWindow {
  startMs: number;
  endMs: number;
}

export function distributeBucketUnionMs(
  boundaries: readonly number[],
  unionByBucket: readonly number[],
  windows: readonly BucketWindow[],
): number[] {
  const result = windows.map(() => 0);
  const bucketCount = Math.min(unionByBucket.length, Math.max(0, boundaries.length - 1));
  if (bucketCount === 0) return result;

  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    let totalMs = 0;
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const bucketStartMs = boundaries[bucket];
      const bucketEndMs = boundaries[bucket + 1];
      const overlapMs = Math.min(window.endMs, bucketEndMs) - Math.max(window.startMs, bucketStartMs);
      if (overlapMs <= 0) continue;
      const bucketWidthMs = bucketEndMs - bucketStartMs;
      const bucketUnionMs = unionByBucket[bucket];
      /* 整桶覆盖是常态（23/24 格），走整数分支：不做除法就不会有舍入，逐格相等才是硬结论 */
      totalMs += overlapMs >= bucketWidthMs
        ? bucketUnionMs
        : Math.round((bucketUnionMs * overlapMs) / bucketWidthMs);
    }
    result[index] = totalMs;
  }
  return result;
}
