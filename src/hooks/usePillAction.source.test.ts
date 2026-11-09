/**
 * Timing — 悬浮条接线的**源码级**判据（[V0.11.27]）
 * -----------------------------------------------------------------------------
 * 这一轮修的是「主界面在计时，悬浮条不动 / 点它没反应」。改法有三段，每一段都可能
 * 「写了但没接线」——这个仓已经在同一个坑里掉过好几次（判据自己能被绕过、钩子没人挂）：
 *
 * 1. Rust 每次状态迁移推快照 → 命令名必须与 Kotlin 的 `@Command` 同名（`overlayPush`）；
 * 2. Kotlin 收到的字段名必须与 Rust 的序列化名一致（`camelCase` 六件）；
 * 3. 前端兜底通道的命令名必须与 Kotlin 同名（`overlayTakeTap` / `overlayClearTap`），
 *    并且 `onTap` 里**真的**先打了标记。
 *
 * 判据都在**去掉注释**之后比：这些词在解释性注释里会正当地出现，拿注释当证据会让用例
 * 变成「谁改注释谁红」。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 读源码并去掉注释（`/* … *\/` 与行首 `//`）。 */
function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const HOOK = code('./usePillAction.ts');
const PLUGIN = code(
  '../../src-tauri/gen/android/app/src/main/java/com/timing/app/TimingNativePlugin.kt',
);
const SERVICE = code(
  '../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/PillService.kt',
);
const READER = code(
  '../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/TimerReader.kt',
);
const PREFS = code('../../src-tauri/gen/android/app/src/main/java/com/timing/app/native/Prefs.kt');
const RUST = code('../../src-tauri/src/models/overlay.rs');
const RUST_APP = code('../../src-tauri/src/app/overlay_push.rs');
const RUST_EVENTS = code('../../src-tauri/src/app/events.rs');

describe('推送通路：Rust → Kotlin（V0.11.27）', () => {
  /** 命令名两端必须同名：不同名的表现是「推送永远不生效」，而两边都不报错。 */
  it('overlay_push_command_matches_on_both_sides', () => {
    expect(RUST_APP).toContain('"overlayPush"');
    expect(PLUGIN).toMatch(/fun overlayPush\(invoke: Invoke\)/);
  });

  /** 推送必须挂在计时状态的**唯一**广播出口上，否则会有一条路径改了状态却没推。 */
  it('push_is_hooked_to_the_state_broadcast', () => {
    expect(RUST_EVENTS).toContain('overlay_push::push');
  });

  /**
   * 字段名：Rust 用 snake_case 声明 + `rename_all = "camelCase"` 序列化，
   * Kotlin 按 camelCase 解析。三条任一条对不上，对应字段就会**静默取默认值**
   * （`runningSince` 落空 → 悬浮条永远不「在跑」，正是主人报的那个现象）。
   */
  it('push_payload_field_names_match', () => {
    expect(RUST).toContain('rename_all = "camelCase"');
    const pairs: Array<[string, string]> = [
      ['status', 'status'],
      ['item', 'item'],
      ['accumulated_sec', 'accumulatedSec'],
      ['running_since', 'runningSince'],
      ['mode', 'mode'],
      ['target_sec', 'targetSec'],
    ];
    for (const [rust, kotlin] of pairs) {
      expect(RUST, `Rust 快照缺字段 ${rust}`).toContain(rust);
      expect(READER, `TimerReader.fromPush 没解析 "${kotlin}" → 该字段永远是默认值`).toContain(
        `"${kotlin}"`,
      );
    }
    /* 反方向也要钉：只检「camelCase 在不在」是**不够**的——同一个字段可以既有一处写对、
       又有一处写成 Rust 原名（本轮变异自证就是这么漏过去的：`optLong` 改坏了、`isNull` 那处
       还留着，命中即绿）。所以 fromPush **整段不许出现 snake_case 键**。
       范围只截到 `fun read(`：后面的 SQL 里当然有 `accumulated_sec` 这些列名。 */
    const start = READER.indexOf('fun fromPush');
    const end = READER.indexOf('fun read(', start);
    const fromPush = READER.slice(start, end > start ? end : start + 1500);
    expect(start, 'TimerReader 里没有 fromPush').toBeGreaterThanOrEqual(0);
    expect(fromPush).not.toMatch(/"(accumulated_sec|running_since|target_sec)"/);
  });

  /** 显示源顺序：先推来的，再读库。反了就等于这一轮白改。 */
  it('pill_prefers_the_pushed_snapshot', () => {
    const body = SERVICE.slice(SERVICE.indexOf('private fun currentSnap()'));
    const pushed = body.indexOf('pushedSnap()');
    const read = body.indexOf('ensureReader()');
    expect(pushed, 'currentSnap 里没有先取推送快照').toBeGreaterThanOrEqual(0);
    expect(read, 'currentSnap 里没有读库兜底').toBeGreaterThan(pushed);
  });

  /** 兜底通道的命令名两端同名。 */
  it('tap_fallback_commands_match', () => {
    for (const cmd of ['overlayTakeTap', 'overlayClearTap']) {
      expect(HOOK, `前端没调 ${cmd}`).toContain(cmd);
      expect(PLUGIN, `Kotlin 没实现 ${cmd}`).toMatch(new RegExp(`fun ${cmd}\\(invoke: Invoke\\)`));
    }
  });

  /** `onTap` 必须**先**打标记再投事件：顺序反了，事件丢在半路时标记也没留下。 */
  it('on_tap_marks_before_triggering', () => {
    const tap = SERVICE.slice(SERVICE.indexOf('private fun onTap()'));
    const body = tap.slice(0, tap.indexOf('private fun expandTemporarily'));
    const mark = body.indexOf('markPendingTap');
    const trigger = body.indexOf('bridge?.invoke');
    expect(mark, 'onTap 没打标记 → 兜底通道永远空转').toBeGreaterThanOrEqual(0);
    expect(trigger).toBeGreaterThan(mark);
  });

  /** 标记必须落盘（服务可能比窗口活得久），而不是一个进程内变量。 */
  it('pending_mark_is_persisted', () => {
    expect(PREFS).toContain('pending_tap_at');
    expect(PREFS).toMatch(/fun markPendingTap\(ctx: Context\)/);
    expect(PREFS).toMatch(/fun pendingTap\(ctx: Context\)/);
    expect(PREFS).toMatch(/fun clearPendingTap\(ctx: Context\)/);
  });

  /** 兜底真失败时要说出来：通知副标题优先显示 `note`，否则用户仍只看到「没有反应」。 */
  it('failure_reason_reaches_the_notification', () => {
    expect(SERVICE).toContain('lastTapError');
    expect(code('../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/OverlayNoti.kt'))
      .toContain('snap.note');
  });

  /** 读不到库时的探路清单要留着：那是报障时唯一能说清「试过哪些路径」的东西。 */
  it('reader_keeps_a_probe_trail', () => {
    expect(READER).toContain('lastProbe');
    expect(READER).toContain('fun fromPush');
  });
});
