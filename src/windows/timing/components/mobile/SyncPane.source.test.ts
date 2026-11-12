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
    '../../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/PillService.kt',
  );
  const READER = code(
    '../../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/TimerReader.kt',
  );
  const HOOK = code('../../hooks/usePillAction.ts');

  /**
   * [V0.11.32] 投递口从「Tauri 插件事件」换成「直接调全局函数」，判据跟着换：
   * 两端那个函数名必须逐字一致（Kotlin `JS_ENTRY` ↔ 前端 `PILL_ENTRY`）。
   * 名字写错的坏法仍然是「点了没反应，两边都不报错」，所以这条不能删。
   */
  it('p8_entry_name_matches_on_both_sides', () => {
    const kotlin = /JS_ENTRY\s*=\s*"([^"]+)"/.exec(PILL_SERVICE)?.[1];
    const ts = /PILL_ENTRY\s*=\s*'([^']+)'/.exec(HOOK)?.[1];
    expect(kotlin, 'PillService 里找不到 JS_ENTRY').toBeTruthy();
    expect(ts, 'usePillAction 里找不到 PILL_ENTRY').toBeTruthy();
    expect(kotlin).toBe(ts);
  });

  /**
   * 投不出去时必须**记下来**，而不是静默失效（[V0.11.29] 起也不再拿「打开主界面」兜底——
   * 那会把「点一下暂停」变成「点一下跳走」，是另一类坏法）。
   * 判据钉函数体：先打标记、没有桥时写 `lastTapError`。
   */
  it('p8_failure_is_marked_and_spoken', () => {
    const at = PILL_SERVICE.indexOf('private fun dispatch(');
    expect(at, '没有 dispatch：投递与核对没有分开').toBeGreaterThanOrEqual(0);
    const body = PILL_SERVICE.slice(at, PILL_SERVICE.indexOf('private fun verify(', at));
    expect(body, '没有桥时没有留下可见原因').toContain('lastTapError =');
    expect(body, '没有桥时也没留下待补做的痕迹').toContain('JS_ENTRY');
    expect(PILL_SERVICE, '点按又变成跳转了').toContain('KIND_TOGGLE');
  });

  /** 原始层不许改计时状态：它只能把「按了一下」交出去。 */
  it('p8_native_layer_never_writes_the_timer', () => {
    expect(PILL_SERVICE).not.toContain('UPDATE time_records');
    expect(PILL_SERVICE).not.toContain('togglePause');
  });

  /** 读库失败要能自愈：reader 为空要重开，异常要进 logcat（v0.11.21 吞掉它 → 永久待机）。 */
  it('p8_reader_self_heals_and_logs', () => {
    expect(PILL_SERVICE).toContain('ensureReader');
    /* [V0.11.27] 日志文案带上了库路径（`read <path> failed`）：报障时要能说出读的是哪个文件。
       **不钉死整句**，只钉「这是 Log.w + 带 failed」——文案要能改，静默不能回来。 */
    expect(READER, '读库失败必须留 logcat').toMatch(/Log\.w\(TAG, "read .*failed/);
    /* 同一个失败还要落到 `note`（→ 通知副标题）：只写 logcat 用户看不见，等于没说话。 */
    expect(READER).toContain('note = "读库失败：');
    expect(READER).toContain('SQLiteDatabase.OPEN_READWRITE');
  });
});

/* 同一个原生插件文件，但断言的是另一件事：导出走系统的「保存到…」。
   不共用上面那个 `PLUGIN` 常量——它只在 P8 的 describe 里可见，跨块引用会让「挪文件」
   这种小重构同时红两组用例，看不出到底坏在哪。 */
describe('备份导出走系统「保存到…」（V0.11.23，PRD P6）', () => {
  const EXPORT = code('../../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/TimingNativePlugin.kt');

  /** 必须是 `ACTION_CREATE_DOCUMENT`：用户自己挑位置，程序不替他定（PRD 五-1）。 */
  it('p6_uses_create_document_intent', () => {
    expect(EXPORT).toContain('Intent.ACTION_CREATE_DOCUMENT');
    expect(EXPORT).toContain('Intent.CATEGORY_OPENABLE');
    expect(EXPORT).toContain('Intent.EXTRA_TITLE');
  });

  /** 字节从 Rust 指定的那份文件读、写进系统给的 URI。 */
  it('p6_streams_bytes_into_the_chosen_uri', () => {
    expect(EXPORT).toContain('contentResolver.openOutputStream(uri)');
    expect(EXPORT).toMatch(/File\(path\)\.readBytes\(\)/);
  });

  /** 取消不是失败：回 `saved: false`，不 reject。 */
  it('p6_cancel_resolves_instead_of_rejecting', () => {
    expect(EXPORT).toMatch(/res\.put\("saved", false\)[\s\S]{0,80}invoke\.resolve\(res\)/);
  });

  /** 写失败要留痕：原文进 logcat，并且把原文交给用户（不许 `getOrDefault` 吞掉）。 */
  it('p6_write_failure_is_logged_and_echoed', () => {
    expect(EXPORT).toContain('android.util.Log.w("TimingExport"');
    expect(EXPORT).toMatch(/invoke\.reject\("写入失败：/);
    expect(EXPORT).not.toContain('getOrDefault');
  });
});
