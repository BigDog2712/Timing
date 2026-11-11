/**
 * Timing — 「补记不碰计时状态机」的机器判据（P1-01 判据⑤，源码哨兵）
 * -----------------------------------------------------------------------------
 * 这条判据没法在 DOM 层完全钉住：`startOrSwitch` 若被顺手加进补记分支，界面看起来是对的
 * （记录写进去了），只有用户过一会儿发现「怎么自己开始计时了」。所以读源码文本做哨兵
 * （同 `hostTimerFormula.source.test.ts` / `usePillAction.source.test.ts` 的做法）：
 *
 *  ① 宿主执行端的补记分支只许调 `createRecord`，**不许**出现 `startOrSwitch` / `togglePause`；
 *  ② 分析窗弹卡的补记处理只许发 `backfill_record` 且右端 clamp 到 `Date.now()`；
 *  ③ 两条意图在协议层是**两个** action（合并会让 P0-05「从此刻开始、不回填历史区间」失效）；
 *  ④ 分析窗仍然**一条写命令都没有**：`patina-host-bridge.toml` 里不许出现 `create_record`。
 *
 * 路径锚法：`fileURLToPath(import.meta.url)` + 仓库根，**不用** `new URL(rel, import.meta.url)`
 * —— Vite 会把后者改写成 `http://localhost` 形态，`readFileSync` 就找不到文件。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from 'node:path';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** `src/services/` → 仓库根（上溯两级） */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** 从 `marker` 起按花括号配平截出那段代码（哨兵专用，不解析 TS 语法）。 */
function sliceBalanced(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到锚点：${marker}`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
      opened = true;
    } else if (source[i] === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`花括号不配平：${marker}`);
}

const BRIDGE = read('src/services/hostIntentBridge.ts');
const DIALOG = read('src/features/history/components/HistoryActivityActionDialog.tsx');
const GATEWAY = read('src/platform/runtime/hostIntentGateway.ts');
const HOST_BRIDGE_ACL = read('src-tauri/permissions/patina-host-bridge.toml');

describe('补记不碰计时状态机（P1-01 判据⑤）', () => {
  it('p101_bridge_backfill_branch_only_writes_a_record', () => {
    const body = sliceBalanced(BRIDGE, 'const handleBackfill = useCallback(');
    expect(body).toContain('createRecord');
    /* 变异：在这一支里加一句 `startOrSwitch(...)` → 本用例红 */
    expect(body).not.toContain('startOrSwitch');
    expect(body).not.toContain('togglePause');
  });

  it('p101_dialog_backfill_handler_emits_the_segment_and_clamps_its_right_edge', () => {
    const body = sliceBalanced(DIALOG, 'const backfill = () =>');
    expect(body).toContain('backfill_record');
    expect(body).toContain('startedAt: target.startTimeMs');
    expect(body).toContain('endedAt: Math.min(target.endTimeMs, Date.now())');
    expect(body).not.toContain('startOrSwitch');
    expect(body).not.toContain('togglePause');
  });

  it('p101_the_two_intents_remain_separate_actions', () => {
    /* 合并成一个 action（「带起止就回填」）会让 P0-05 的「从此刻开始」在协议层失效 */
    expect(GATEWAY).toContain('"start_timer_for_activity"');
    expect(GATEWAY).toContain('"backfill_record"');
    expect(GATEWAY).toContain('startedAt: number');
    expect(GATEWAY).toContain('endedAt: number');
  });

  it('p101_analysis_window_still_has_no_write_command', () => {
    /* 补记的写库发生在**药丸**侧（typed IPC）；分析窗的 ACL 一条写命令都不许有 */
    expect(HOST_BRIDGE_ACL).not.toContain('create_record');
    expect(HOST_BRIDGE_ACL).toContain('list_records');
  });
});
