/**
 * Timing — 手机端「数据管理」与悬浮窗的**源码级**判据（V0.11.22，PRD P3 / P4 / P8）
 * -----------------------------------------------------------------------------
 * 这三条判据钉的是「删干净了没有」与「两端的事件名是不是同一个」，都不是渲染行为：
 *
 * - P3：本地日记目录那条通路下线后，`SyncPane` 里**不许**再出现它的任何入口文案；
 * - P4：云端不可用时的那句话必须还在（它是用户唯一能照做的指路牌）；
 * - P8：悬浮窗「读库失败要留痕 + 要重试」「原生事件名与前端一致」——Kotlin 没有单测框架，
 *   而这条链一旦写错，表现是「点了没反应」且两边都不报错，只能靠文本断言兜住。
 *
 * 判据都在**去掉注释**之后比：注释里正当地提到这些词（比如解释「为什么删掉只用本地」），
 * 拿注释当证据会让这条用例变成「谁删注释谁红」。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 读源码并去掉注释（`/* … *\/` 与行首 `//`、Kotlin 的 `//`）。 */
function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const SYNC_PANE = code('./SyncPane.tsx');

describe('数据管理页只剩云端（P3）', () => {
  /** 本地日记目录那条通路的四个入口词，一个都不许留在页面上。 */
  it('p3_local_vault_entries_are_gone', () => {
    for (const word of ['日记目录', '选择目录', '更换', 'safPick', 'safStatus']) {
      expect(SYNC_PANE, `SyncPane 里还有「${word}」，本地同步没有删干净`).not.toContain(word);
    }
  });

  /** 云端通道二选一也一并移除：只留云端之后，「只用本地」不再指向任何落点。 */
  it('p3_channel_switch_is_gone', () => {
    expect(SYNC_PANE).not.toContain('只用本地');
    expect(SYNC_PANE).not.toContain('data-cloud-channel');
  });

  /** 备份与恢复确实挂在页面上（而不是只写了组件没人用）。 */
  it('p3_backup_pane_is_mounted', () => {
    expect(SYNC_PANE).toContain('<SyncBackupPane');
  });
});

describe('云端不可用时的指路牌（P4）', () => {
  it('p4_not_ready_sentence_stays', () => {
    expect(SYNC_PANE).toContain('云端还没填全，暂时不会同步。');
  });

  it('p4_run_button_is_disabled_until_ready', () => {
    expect(SYNC_PANE).toMatch(/disabled=\{busy \|\| !ready\}/);
  });
});

describe('悬浮窗事件链两端同名（P8）', () => {
  const PILL_SERVICE = code(
    '../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/PillService.kt',
  );
  const READER = code(
    '../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/TimerReader.kt',
  );
  const PLUGIN = code('../../../src-tauri/gen/android/app/src/main/java/com/timing/app/TimingNativePlugin.kt');
  const HOOK = code('../../hooks/usePillAction.ts');

  /** 事件名是两边各写一份的字符串：改一处忘另一处的表现是「点了没反应」，两边都不报错。 */
  it('p8_event_name_matches_on_both_sides', () => {
    const kotlin = /EVENT_TOGGLE\s*=\s*"([^"]+)"/.exec(PILL_SERVICE)?.[1];
    const ts = /PILL_TOGGLE_EVENT\s*=\s*'([^']+)'/.exec(HOOK)?.[1];
    expect(kotlin, 'PillService 里找不到 EVENT_TOGGLE').toBeTruthy();
    expect(ts, 'usePillAction 里找不到 PILL_TOGGLE_EVENT').toBeTruthy();
    expect(kotlin).toBe(ts);
  });

  /** 没人在听时必须退回「打开主界面」，不能静默失效。 */
  it('p8_falls_back_to_opening_the_app', () => {
    expect(PLUGIN).toContain('hasListener(event)');
    expect(PILL_SERVICE).toMatch(/bridge\?\.invoke\(EVENT_TOGGLE\) != true/);
    expect(PILL_SERVICE).toContain('openApp()');
  });

  /** 原始层不许改计时状态：它只能把「按了一下」交出去。 */
  it('p8_native_layer_never_writes_the_timer', () => {
    expect(PILL_SERVICE).not.toContain('UPDATE time_records');
    expect(PILL_SERVICE).not.toContain('togglePause');
  });

  /** 读库失败要能自愈：reader 为空要重开，异常要进 logcat（v0.11.21 吞掉它 → 永久待机）。 */
  it('p8_reader_self_heals_and_logs', () => {
    expect(PILL_SERVICE).toContain('ensureReader');
    expect(READER).toContain('Log.w(TAG, "read timing.db failed');
    expect(READER).toContain('SQLiteDatabase.OPEN_READWRITE');
  });
});
