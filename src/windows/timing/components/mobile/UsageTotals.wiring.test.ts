/**
 * Timing — 「总量口径」与「配对口径」的源码级判据（[0.12.8]）
 * -----------------------------------------------------------------------------
 * 从 `UsageBridge.wiring.test.ts` 拆出来的：那边已经 258 行，再加两组就撞
 * `check:size` 的 300 行上限。边界也是清楚的：那边盯「跨桥的东西怎么装」，
 * 这边盯「两个数分别从哪来、凭什么这么配对」。
 *
 * ⚠️ 这一版是**第三次**定口径，前两版都被真机数据推翻了，别再凭直觉改回去：
 *   ① 拿 `ACTIVITY_PAUSED` 当「包级离开」⇒ 同包内换 Activity 被切碎，
 *      界面上一堆「09:01-09:01」（0.12.7 用户原话）；
 *   ② 拿系统桶总量（`queryAndAggregateUsageStats`）⇒ MIUI 的日桶从 14:36 起算，
 *      「今天」把昨天下午也算进来：王者荣耀 5 小时 12 分 vs 系统页面 1 小时 56 分；
 *   ③ 拿「另一个包 RESUMED」当离开 ⇒ 别的包闪一下就把这段结掉：同一天王者只算出
 *      25 分钟，而系统页面写 1 小时 56 分。
 *
 * 现在只有一条路：**按「包名 + Activity 类名」配对，离开只认同一个 Activity 的
 * PAUSED/STOPPED**。实测与系统页面四个应用全部吻合到分钟（见 `UsageStats.kt` 的注释表）。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 去注释之后再比：解释性注释里会正当地出现类名与签名，不去掉就是假红。 */
function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const SYSTEM = code(
  '../../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/native/UsageStats.kt',
);
const SPANS = code('./usageSpans.ts');
const SPAN_LIST = code('./UsageSpanList.tsx');

describe('总量口径与配对口径（0.12.8）', () => {
  it('st21_pairs_per_activity_and_takes_the_total_from_those_spans', () => {
    /* ① 配对键必须是「包名 + 类名」。写成只用包名 ⇒ 同包换 Activity 又变成碎段；
       不配对（只认别的包 RESUMED）⇒ 别的包闪一下就把长段结掉，少算几倍。 */
    expect(SYSTEM, '配对键退回了「只看包名」').toContain('pkg + "#" +');
    expect(SYSTEM, '没有按 Activity 键去关段').toContain('closeKey(key, at)');
    expect(SYSTEM, '重复 RESUMED 会把进入时刻往后推（段会变短）').toContain(
      'if (!open.containsKey(key)) open[key] = at',
    );
    /* 离开信号：同一个 Activity 的 PAUSED/STOPPED（这正是系统自己的记账方式） */
    expect(SYSTEM, '离开信号没有认 ACTIVITY_PAUSED').toContain(
      'UsageEvents.Event.ACTIVITY_PAUSED',
    );
    /* 息屏/锁屏要把当时开着的全都结掉：只字不提的话，挂着的那段会一路延伸到第二天 */
    expect(SYSTEM, '息屏没有结掉开着的段').toContain('closeAll(at)');
    expect(SYSTEM, '没有认息屏/锁屏').toContain('UsageEvents.Event.SCREEN_NON_INTERACTIVE');

    /* ② 系统桶一个字节都不许读。这两条是 5 小时 12 分的**根因**：
       日桶起点是昨天 14:36，聚合版还把同一包的多份快照相加。 */
    expect(SYSTEM, '又去读系统桶总量了 —— 日桶跨天，会把昨天下午算进今天').not.toContain(
      'queryAndAggregateUsageStats',
    );
    expect(SYSTEM, '又去查逐桶数据了').not.toContain('queryUsageStats');
    expect(SYSTEM, '还在用系统总量字段').not.toContain('totalTimeInForeground');

    /* ③ 总量只能从段累加；首末也从段推（`firstTimeStamp` 是桶起点，会写成 00:00） */
    expect(SYSTEM, '总量不是从段累加出来的').toContain(
      'secMs[span.pkg] = (secMs[span.pkg] ?: 0L) + span.ms',
    );
    expect(SYSTEM, '首末没有从段推').toContain('firstOf[pkg]');
    /* ④ 合并要在滤短段之前：反过来的话一段 300 毫秒碎片会把长段劈成两个 */
    expect(SYSTEM, '没有合并相接的段（一天上百次切换会原样上屏）').toContain('mergeByPackage');
  });

  it('st22_short_spans_collapse_into_a_count', () => {
    /* 门槛是 1 分钟。写成 1 秒/1 毫秒时列表照样一屏「09:01 - 09:01」 */
    expect(SPANS, '门槛不是 60000 毫秒').toContain('MIN_VISIBLE_SPAN_MS = 60_000');
    expect(SPAN_LIST, '短段没有被滤掉（用户会又看到一堆不到一分钟）').toContain(
      'MIN_VISIBLE_SPAN_MS',
    );
    expect(SPAN_LIST, '短段没有被折成计数，而是直接消失').toContain('次打开不到 1 分钟');
    /* 合计与时段对不上时必须说明，不许闷着 */
    expect(SPAN_LIST, '没有「其余 … 没有分段记录」这句').toContain('没有分段记录');
    /* 合并必须带 ≤1 分钟的空隙容差（0.12.8 追加）：没有它，同应用换 Activity 留下的
       几十毫秒空隙会把一次连续使用切成一串碎段 —— 滤短段治标，合并治本。 */
    expect(SPANS, '合并没有空隙容差 —— 碎段会原样回来').toContain('MERGE_GAP_MS');
    /* 采集层不许跟着滤：滤在采集层，库里就少了事实，缺口更解释不清 */
    expect(SYSTEM, '把 1 分钟的门槛写进了采集层（数据不该在这一层被丢）').not.toContain(
      'MIN_VISIBLE_SPAN_MS',
    );
  });
});
