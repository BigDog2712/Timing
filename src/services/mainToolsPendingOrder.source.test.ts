/**
 * Timing — 「先写 pending 再 show」的机器判据（P1-02 / T04，源码哨兵）
 * -----------------------------------------------------------------------------
 * `tools_navigation::deliver()` 里两行的**顺序**是冷启动落点的唯一保证：
 *
 *     state.put(view);                                                ← ① 先写待消费落点
 *     if !super::show_main_window(app, …) { state.take(); return Err(…) }   ← ② 再 show
 *
 * 顺序反了（先 show 再 put）时，**热路径完全正常**——窗已存在、门铃立刻把 `take` 叫起来，
 * 用户点几次都看不出问题。只有「分析窗还没创建」的冷启动会拿不到落点、停在默认页。而这条
 * 路径需要真实 `AppHandle` + 真实窗口生命周期，**没有任何运行时单测能发现**（本仓库
 * `tauri` 未开 `test` feature，`AppHandle` 造不出来，见 T01 的同一限制）。所以只能读源码
 * 文本钉住先后，并连带钉住「show 失败必须回滚刚写的 pending」。
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

/** 从 `marker` 起按花括号配平截出那段代码（哨兵专用，不解析 Rust 语法）。 */
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

/** 去注释：注释里正当地写着这两行的名字，拿注释当证据会让用例变成「删注释就红」。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const DELIVER = sliceBalanced(
  stripComments(read('src-tauri/src/app/insight/main_window/tools_navigation.rs')),
  'fn deliver<R: Runtime>(',
);

describe('deliver() 的顺序（P1-02 冷启动落点）', () => {
  it('p102_pending_is_written_before_the_window_is_shown', () => {
    const put = DELIVER.indexOf('state.put(view)');
    const show = DELIVER.indexOf('show_main_window(');
    /* 两个锚点必须都在：锚点被改名而本文件没跟着改，规则就会去扫一个不存在的字符串，
       于是永远「通过」而保护已经消失（PRD R7 警告的最隐蔽回归）。 */
    expect(put, '找不到 `state.put(view)`：锚点被改名了，本哨兵已失效').toBeGreaterThanOrEqual(0);
    expect(show, '找不到 `show_main_window(`：锚点被改名了，本哨兵已失效').toBeGreaterThanOrEqual(0);
    /* 变异：把 `state.put(view)` 挪到 `show_main_window` 之后 → 本用例红
       （症状只有冷启动：先杀光 timing.exe 再点「在分析窗看总览」会停在默认视图）。 */
    expect(put, 'pending 必须先写后 show，否则冷启动拿不到落点').toBeLessThan(show);
  });

  it('p102_failed_show_rolls_the_pending_target_back', () => {
    /* show 失败（建窗 / reveal 失败）若不回滚，下一次分析窗起来会消费到一个陈旧落点，
       莫名其妙跳到别的页面——比「没反应」更难排查。 */
    const show = DELIVER.indexOf('show_main_window(');
    expect(show).toBeGreaterThanOrEqual(0);
    expect(DELIVER.indexOf('state.take()', show), 'show 失败必须回滚 pending').toBeGreaterThan(show);
  });
});
