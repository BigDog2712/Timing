/**
 * Timing — 恢复弹层的「别打扰」判据（[0.12.8]）
 * -----------------------------------------------------------------------------
 * 用户原话：「每次进入软件都会弹出一个提醒，但我未开始计时」。
 *
 * 根因不是弹层写错了，而是**它太诚实**：主界面那个大圆钮是「点一下就开始了」，
 * 很多人点一下就走，库里留下一条 0 秒的 `running` 记录。下次冷启动看见
 * 「上次计时没有正常结束」，用户的结论是「这软件有 bug」，而他压根没打算计时。
 *
 * 判据钉三件事：
 *   ① 不足 1 分钟的残留**不进弹层**，直接静默丢弃；
 *   ② 丢弃走的是同一个入口（`resolveOpenRecord` + `discard`），不另开一条删库小路；
 *   ③ 丢弃失败要**退回弹层** —— 静默失败会让记录永远卡在库里，下次照样弹。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const BOOT = code('./useAppBootstrap.ts');

describe('恢复弹层不打扰误触', () => {
  it('rcv01_under_a_minute_is_silently_discarded', () => {
    expect(BOOT, '不足 1 分钟的残留还是弹了').toContain('state.session.accumulatedSec < 60');
    expect(BOOT, '门槛不是 60 —— 写小了会把真计过时的记录也吞掉').toContain(
      'accumulatedSec < 60',
    );
    /* 丢弃必须走既有入口，不许前端自己拼一条删库 */
    expect(BOOT, '丢弃没有走 resolveOpenRecord').toContain(
      "resolveOpenRecord({ action: 'discard'",
    );
    /* 成功丢弃后要刷新状态，否则本地 store 里还留着那条 running */
    expect(BOOT, '丢弃后没有刷新计时状态').toMatch(/resolveOpenRecord[\s\S]{0,400}?refresh\(\)/);
  });

  it('rcv02_discard_failure_falls_back_to_the_sheet', () => {
    /* 静默失败 = 记录永远卡在库里，下次进来自动再弹一次，用户只会觉得「又来了」 */
    expect(BOOT, '丢弃失败没有退回弹层').toMatch(
      /resolveOpenRecord[\s\S]{0,900}?setRecover\(/,
    );
    /* 真的计过时的（≥1 分钟）仍然要弹，让用户决定 */
    expect(BOOT, '真正的残留记录不再弹了').toContain('setRecover(state.session)');
  });
});
