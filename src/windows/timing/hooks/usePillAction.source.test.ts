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
  '../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/TimingNativePlugin.kt',
);
const SERVICE = code(
  '../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/PillService.kt',
);
const READER = code(
  '../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/TimerReader.kt',
);
const PREFS = code('../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/native/Prefs.kt');
const VIEW = code(
  '../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/PillView.kt',
);
const NOTI = code(
  '../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/OverlayNoti.kt',
);
const RUST = code('../../../../src-tauri/src/models/overlay.rs');
const RUST_APP = code('../../../../src-tauri/src/app/overlay_push.rs');
const RUST_EVENTS = code('../../../../src-tauri/src/app/events.rs');

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

  /** `onTap` 必须**先**打标记再投出去：顺序反了，这一按丢在半路时标记也没留下。 */
  it('action_marks_before_dispatching', () => {
    const at = SERVICE.indexOf('private fun requestAction(');
    expect(at, '服务里没有 requestAction → 短按与通知按钮没有共同入口').toBeGreaterThanOrEqual(0);
    /* 切到 `expandTemporarily` 为止：`dispatch` / `verify` 都夹在中间，按固定字数截会漏 */
    const body = SERVICE.slice(at, SERVICE.indexOf('private fun expandTemporarily', at));
    const mark = body.indexOf('markPendingAction');
    const send = body.indexOf('dispatch(kind)');
    expect(mark, 'requestAction 没打标记 → 兜底通道永远空转').toBeGreaterThanOrEqual(0);
    expect(send, 'requestAction 没有真的投出去').toBeGreaterThanOrEqual(0);
    expect(send, '先投后打标记 → 投失败时这一按彻底没了').toBeGreaterThan(mark);
  });

  /**
   * 短按与通知按钮必须走**同一个**入口。
   *
   * 各写一份的后果不是「多几行恶心」，而是两条链会漂：老版本通知按钮能暂停，
   * 新版本某天只剩短按能用，而没有任何用例会红。
   */
  it('tap_and_notification_buttons_share_one_entry', () => {
    const tap = SERVICE.slice(SERVICE.indexOf('private fun onTap()'));
    const tapBody = tap.slice(0, tap.indexOf('private fun requestAction'));
    expect(tapBody).toContain('requestAction(KIND_TOGGLE)');
    expect(SERVICE).toContain('ACTION_TOGGLE -> requestAction(KIND_TOGGLE)');
    expect(SERVICE).toContain('ACTION_FINISH -> requestAction(KIND_FINISH)');
  });

  /**
   * 标记必须落盘（服务可能比窗口活得久），而且必须带**动作类型**。
   *
   * 只存时间戳的话，「点了结束但没人接」在回前台时会被当成交替执行——
   * 用户看到的是「我明明点了结束，它反而又跑起来了」。
   */
  it('pending_mark_carries_the_action_kind', () => {
    expect(PREFS).toContain('pending_action');
    expect(PREFS).toMatch(/fun markPendingAction\(ctx: Context, kind: String\)/);
    expect(PREFS).toMatch(/fun pendingAction\(ctx: Context\): PendingAction\?/);
    expect(PREFS).toMatch(/fun clearPendingAction\(ctx: Context\)/);
    /* 只钉符号名是不够的（第一版就是这么写的）：把写入换成旧键、把 kind 丢掉，符号照样在。
       所以要看**函数体**：写的是新键、写进去的值带动作类型、并且顺手清掉旧键。 */
    const at = PREFS.indexOf('fun markPendingAction');
    expect(at, '没有 markPendingAction').toBeGreaterThanOrEqual(0);
    const body = PREFS.slice(at, PREFS.indexOf('fun pendingAction', at));
    expect(body, '标记没写在新键上 → 旧键被读到两次，同一按执行两下').toContain(
      'K_PENDING_ACTION',
    );
    expect(body, '标记没带动作类型 → 补做时只能猜「切换」').toContain('$kind@');
    expect(body, '新写法没清旧键 → 升级后同一按可能被执行两次').toContain(
      'remove(K_PENDING_TAP)',
    );
    /* 读侧要能把「动作@时间戳」拆开，否则带类型也白搭。 */
    expect(PREFS).toContain("substringBefore('@')");
    expect(PREFS).toContain("substringAfter('@')");
  });

  /** 动作类型要能从原生一路走到前端：`overlayTakeTap` 不回 action，前端就只能猜。 */
  it('take_tap_returns_the_action', () => {
    expect(PLUGIN).toContain('res.put("action"');
    expect(HOOK).toContain('res.action');
  });

  /** 兜底真失败时要说出来：通知副标题优先显示 `note`，否则用户仍只看到「没有反应」。 */
  it('failure_reason_reaches_the_notification', () => {
    expect(SERVICE).toContain('lastTapError');
    expect(code('../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/OverlayNoti.kt'))
      .toContain('snap.note');
  });

  /** 读不到库时的探路清单要留着：那是报障时唯一能说清「试过哪些路径」的东西。 */
  it('reader_keeps_a_probe_trail', () => {
    expect(READER).toContain('lastProbe');
    expect(READER).toContain('fun fromPush');
  });

  /** 通知按钮的意图名两端同名（赋值点在服务里，通知侧只引用常量，避免两份字符串）。 */
  it('notification_action_names_match', () => {
    expect(SERVICE).toContain('"com.timing.app.action.PILL_TOGGLE"');
    expect(SERVICE).toContain('"com.timing.app.action.PILL_FINISH"');
    expect(NOTI).toContain('PillService.ACTION_TOGGLE');
    expect(NOTI).toContain('PillService.ACTION_FINISH');
  });

  /** 结束必须有个视觉落点：状态机结束后直接回 idle，不画绿环就和「本来就没计时」一样。 */
  it('finish_has_a_visual_landing', () => {
    expect(VIEW).toContain('done -> Tk.PILL_OK');
    expect(SERVICE).toContain('view.done = now < doneUntil');
  });

  /** 显示口径与归档的原生版（`android-app` 0.3.6）一致：倒计时向上取整、小时补两位。 */
  it('clock_matches_the_old_formatting', () => {
    expect(VIEW, '倒计时没有向上取整 → 最后一秒早一秒显示 00:00').toContain('ceil(nowSec)');
    expect(VIEW).toContain('"%02d:%02d:%02d"');
    expect(NOTI).toContain('"%02d:%02d:%02d"');
  });

  /** 暂停不换色（老版本保持蓝）：灰会让「暂停」和「待机」看起来一模一样。 */
  it('paused_keeps_the_accent_color', () => {
    expect(VIEW, 'PillView 里又出现了灰色待机色').not.toContain('PILL_IDLE');
  });
});

/**
 * 手势语义定稿（[V0.11.29]）：**点按只切计时，长按才跳转**。
 *
 * 主人原话：「点按暂停 长按再跳转至界面」。在此之前有两处会把点按变成跳转：
 * 1. `onTap` 里「圆点未展开 → 先展开、`return`」，第一下不吃状态；
 * 2. `requestAction` 投不出去时 `openApp()` 兜底 —— 前端没在听的那一按直接把人拽走。
 *
 * 这两条都属于「读起来很合理、用起来很恼人」，所以钉成源码判据：谁想加回来，先红。
 */
describe('手势语义：点按切计时，长按才跳转（V0.11.29）', () => {
  const DRAG = code(
    '../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/overlay/PillDrag.kt',
  );

  /** `onTap` 整个函数体里不许出现 `openApp`。 */
  it('tap_never_opens_the_app', () => {
    const at = SERVICE.indexOf('private fun onTap()');
    expect(at, '服务里没有 onTap').toBeGreaterThanOrEqual(0);
    const body = SERVICE.slice(at, SERVICE.indexOf('private fun requestAction(', at));
    expect(body, 'onTap 里出现了 openApp → 点一下会跳走').not.toContain('openApp');
    expect(body).toContain('requestAction(KIND_TOGGLE)');
  });

  /** 投不出去时也不许拿「打开主界面」当兜底（那等于把点按偷偷换成跳转）。 */
  it('failed_action_does_not_steal_a_tap', () => {
    const at = SERVICE.indexOf('private fun requestAction(');
    expect(at, '服务里没有 requestAction').toBeGreaterThanOrEqual(0);
    const body = SERVICE.slice(at, SERVICE.indexOf('fun expandTemporarily', at));
    expect(body, 'requestAction 里出现 openApp → 前端没在听时点按会跳走').not.toContain('openApp');
    expect(body, '失败没有留下可见原因').toContain('lastTapError =');
  });

  /** 长按这一档必须还在：它现在是**唯一**能回主界面的手势。 */
  it('long_press_still_opens_the_app', () => {
    expect(SERVICE, '接线断了：长按不再打开主界面').toContain(
      'PillDrag(this, wm, view, params, ::onTap, ::openApp)',
    );
    expect(DRAG).toContain('onLongPress()');
    expect(DRAG).toContain('LONG_PRESS_MS = 520L');
  });

  /** 圆点形态下第一下不许再被「只展开」吃掉 —— 展开了但不切状态，就是主人说的「没反应」。 */
  it('dot_tap_is_not_swallowed_by_expand', () => {
    const at = SERVICE.indexOf('private fun onTap()');
    const body = SERVICE.slice(at, SERVICE.indexOf('private fun requestAction(', at));
    expect(body, 'onTap 里又有「展开后 return」的分支 → 第一下不切状态').not.toMatch(
      /expandTemporarily\(\)\s*\n\s*return/,
    );
    /* 展开本身要留着：它是这一按唯一看得见的落点。 */
    expect(body).toContain('expandTemporarily()');
  });
});
