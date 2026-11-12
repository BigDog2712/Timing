/**
 * Timing — 「区间视图的四条数据线真的接通了」的源码哨兵（0.12.1 末）
 * -----------------------------------------------------------------------------
 * 为什么需要它：区间视图读便利贴/待办走的是**宿主的**命令，而分析窗默认一条宿主命令都调不了。
 * 漏登记 ACL 时的症状是「窗开着、四块卡片都在、便利贴与待办永远是空的、两端零日志」——
 * 这是本项目反复踩过的形态（0.11.x「插件注册 = ACL 静默拒绝」）。
 * 纯靠手测发现不了：一张真的空笔记列表和"被拒的"空笔记列表长得一模一样。
 *
 * 四条判据都读源码文本（同 `backfillIntentWiring.source.test.ts` 的做法）：
 *   ① ACL 放行单里有这五条只读命令；
 *   ② 放行单里**没有**任何写命令前缀（create_/update_/delete_/toggle_/start_/stop_）；
 *   ③ 反向桥真的调用了 `list_records` / `note_list` / `todo_list`（钉接线，不是钉名字）；
 *   ④ 区间聚合真的接到了那个桥（hook 里三处 import 都在）。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from 'node:path';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** `src/features/history/` → 仓库根（上溯三级） */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const ACL = read('src-tauri/permissions/patina-host-bridge.toml');
const HISTORY = read('src/windows/patina/features/history/components/History.tsx');
const GATEWAY = read('src/windows/patina/platform/runtime/historyRangeGateway.ts');
const HOOK = read('src/windows/patina/features/history/hooks/useHistoryRangeData.ts');

describe('历史页区间视图 · 反向桥接线', () => {
  it('h01_acl_allows_the_five_read_only_commands', () => {
    const allowLine = ACL.slice(ACL.indexOf('commands.allow'));
    for (const command of ['list_records', 'list_items', 'get_timer_state', 'note_list', 'todo_list']) {
      expect(allowLine, `ACL 少放行 ${command}（会被静默拒绝，两端零日志）`).toContain(`"${command}"`);
    }
  });

  it('h02_acl_still_grants_zero_write_commands', () => {
    /* 扩读面很容易顺手把写面带进来；这一条把"零写面"钉死 */
    const allowLine = ACL.slice(ACL.indexOf('commands.allow'));
    for (const forbidden of ['create_', 'update_', 'delete_', 'toggle_', 'start_', 'stop_', 'archive_']) {
      expect(allowLine, `ACL 里出现了写命令 ${forbidden}*`).not.toContain(forbidden);
    }
  });

  it('h03_gateway_actually_calls_the_host_commands', () => {
    /* 钉的是调用，不是注释：把 `note_list` 那段删掉、只留名字 → 本条红 */
    expect(GATEWAY).toContain('invoke<RawRecordPage>("list_records"');
    expect(GATEWAY).toContain('invoke<RawNote[]>("note_list"');
    expect(GATEWAY).toContain('invoke<RawTodo[]>("todo_list"');
    /* 翻页：30 天一次取不完，`limit` 与翻页上限必须都在 */
    expect(GATEWAY).toContain('page,');
    expect(GATEWAY).toContain('RECORD_MAX_PAGES');
  });

  it('h04_hook_wires_all_four_sources_into_the_aggregate', () => {
    for (const source of [
      'loadActivityAggregateRange',
      'loadHistoryRangeRecords',
      'loadHistoryRangeNotes',
      'loadHistoryRangeTodos',
      'buildHistoryRangeAggregate',
    ]) {
      expect(HOOK).toContain(source);
    }
    /* 分桶边界要交给后端，而不是前端自己按 dateKey 归桶（两份日界 = 两个数） */
    expect(HOOK).toContain('buildHistoryRangeBucketBoundaries');
  });

  it('h05_single_day_uses_the_same_blocks_as_ranges', () => {
    /* 「当日与往期格式统一」的源码哨兵。
       单日不许再退回自己那套（三行摘要 + 环形应用分布 + 计时重叠）：
       那是另一份口径（session.duration 累加 vs 墙钟裁剪），同一天在两边会差几分钟。
       判据钉的是**接线**：单日渲染的是 `HistoryRangeView` 且显式关掉逐日柱。 */
    expect(HISTORY).toContain('<HistoryRangeView');
    expect(HISTORY).toContain('showDailyBars={false}');
    expect(HISTORY).toContain('mode: "day"');
    for (const retired of [
      'HistoryDayDistributionQuickActions',
      'HistoryDaySummaryPanel',
      'HistoryTimingOverlap',
    ]) {
      expect(HISTORY, `单日页又挂回了旧版式的 ${retired}`).not.toContain(retired);
    }
  });

  it('h06_timeline_reads_raw_sessions_not_the_bucketed_ones', () => {
    /* 逐日时间轴必须拿**未聚合**的会话：`loadActivityAggregateRange` 传了逐日桶边界后，
       后端已把记录压成「起点 = 当日 00:00、长度 = 当日总时长」，时长对、位置全丢。
       用那份画时间轴，结果是每天一根从 00:00 起的实心柱 —— 不报错、也绝不可能是对的。
       所以这条钉死：hook 里另取一份原始会话，并且真的把它传进聚合。 */
    expect(HOOK).toContain('getSessionsInRangeWithoutTitleSamples');
    expect(HOOK).toContain('timelineSessions');
    /* 单日也要显式关掉逐日带：那一天上面已经有可缩放的时间轴，两条并存会自相矛盾 */
    expect(HISTORY).toContain('showTimeline={false}');
  });
});
