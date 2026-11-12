/**
 * Timing — 「两窗数字每秒完全一致」的机器判据（P0-04 判据②）
 * -----------------------------------------------------------------------------
 * 这条判据靠肉眼是测不出来的：两窗各跑各的秒表时，差 1 秒看不出来，跑一晚上能差几十秒。
 * 而 L9 禁止跨窗 import，所以**不能**在测试里同时调用两边的函数做对拍。
 *
 * 于是用本仓既有的做法：**读源码文本做哨兵**（同 `usePillAction.source.test.ts`、
 * `hostAccentBridge.test.ts` 的「逐字复制 + 文本哨兵」）。钉三件事：
 *
 *  ① 宿主 `computeLiveSec`（`src/hooks/useTimerTick.ts`）与 分析窗 `computeHostLiveSec`
 *     （`src/platform/runtime/hostTimerGateway.ts`）的**返回值表达式逐字同形**
 *     （只允许变量名不同：`session.runningSince` → `runningSince`，`Date.now()` → `nowMs`）。
 *  ② 两侧都**没有** `Math.round`：一取整就会出现「同一秒里一边 59 一边 60」。
 *  ③ 分析窗的 hook **不自己算秒**：`useHostTimerState.ts` 只把 `nowMs` 喂给公式，
 *     文件里不出现 `Math.floor` / `Math.round` —— 一旦出现，就是第二套计算诞生了。
 *
 * 读文件放在**模块级**（与 `usePillAction.source.test.ts` 一致）：路径写错时直接在这一行报，
 * 不会伪装成某个用例的断言失败。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSrc(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

const HOST_TICK = readSrc('../hooks/useTimerTick.ts');
const ANALYSIS_GATEWAY = readSrc('../../patina/platform/runtime/hostTimerGateway.ts');
const ANALYSIS_HOOK = readSrc('../../patina/shell/hooks/useHostTimerState.ts');

/** 把两侧的差异（变量名）抹平后应当逐字相等的那一行。 */
const SHARED_EXPRESSION = 'return base + (deltaMs > 0 ? Math.floor(deltaMs / 1000) : 0);';

describe('计时公式唯一（P0-04 判据②：两窗每秒一致）', () => {
  it('host_and_analysis_use_the_same_live_seconds_expression', () => {
    expect(HOST_TICK).toContain(SHARED_EXPRESSION);
    expect(ANALYSIS_GATEWAY).toContain(SHARED_EXPRESSION);
  });

  it('host_and_analysis_both_clamp_negative_deltas_to_zero', () => {
    /* 系统时钟回拨时，直接 Math.floor 会让计时倒着走（用户看到 -3600 秒） */
    expect(HOST_TICK).toContain('deltaMs > 0 ? Math.floor(deltaMs / 1000) : 0');
    expect(ANALYSIS_GATEWAY).toContain('deltaMs > 0 ? Math.floor(deltaMs / 1000) : 0');
  });

  it('neither_side_rounds_to_seconds_or_minutes', () => {
    /* 取整会让两窗在同一秒里分别显示 59 / 60 */
    expect(HOST_TICK).not.toContain('Math.round');
    expect(ANALYSIS_GATEWAY).not.toContain('Math.round');
  });

  it('analysis_hook_does_not_compute_seconds_itself', () => {
    /* hook 只负责「每 1 秒推进 nowMs」，秒数一律来自 gateway 的那一条公式 */
    expect(ANALYSIS_HOOK).toContain('computeHostLiveSec');
    expect(ANALYSIS_HOOK).toContain('nowMs');
    expect(ANALYSIS_HOOK).not.toContain('Math.floor');
    expect(ANALYSIS_HOOK).not.toContain('Math.round');
  });

  it('the_two_copies_point_back_at_each_other_so_a_silent_drift_gets_noticed', () => {
    /* 单向注释不够：改一侧的人必须被指到另一侧的路径上 */
    expect(ANALYSIS_GATEWAY).toContain('useTimerTick.ts');
    expect(HOST_TICK).toContain('IPC-CONTRACT-v2');
  });
});
