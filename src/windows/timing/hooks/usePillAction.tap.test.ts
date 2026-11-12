/**
 * Timing — 悬浮条「点按真的生效」的源码判据（[V0.11.32]）
 * -----------------------------------------------------------------------------
 * 主人报的原始现象：「点按暂停 / 开始计时功能未成功，不过小圆点点击后暂时变成悬浮条
 * 形态可行」。也就是说原生的那半截（展开 → 改形态）是好的，**投给前端之后没有任何事发生**。
 *
 * 根因在投递方式：0.11.22 起用的是 `Plugin.trigger` + `addPluginListener`，而注册那一步
 * 是 Tauri 自己的 `registerListener`（内部 Jackson 反射）。本仓为了躲 R8 早把自己那套
 * `parseArgs` 换成了 `getArgs()`，却在这条链上留了别人的反射；注册失败会被前端 `.catch()`
 * 吞掉、`hasListener` 永远 false → 点按只有原生反应。两端都不报错，所以查了很久。
 *
 * 这一轮换成「原生直接 evaluateJavascript 调 window.__timingPillTap」，并把
 * 三个动作类型、失败自检、落点（计时页）、待机即记未命名这几件事都钉成判据。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 读源码并去掉注释（`/* … *\/` 与行首 `//`）：这些词在解释性注释里会正当地出现。 */
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

describe('悬浮条点按：一条谁也不会静默吞掉的投递路（V0.11.32）', () => {
  /**
   * 入口名两端同名：原生 `evaluateJavascript` 调的就是这个名字，
   * 任一侧改了另一侧忘了，表现是「按了没反应」，而两边都不报错。
   */
  it('entry_name_matches_on_both_sides', () => {
    expect(SERVICE).toContain('JS_ENTRY = "__timingPillTap"');
    expect(HOOK).toContain("PILL_ENTRY = '__timingPillTap'");
    /* 三个动作类型也要同名：写错一个词，那个动作就静默失效 */
    for (const kind of ['toggle', 'finish', 'open']) {
      expect(SERVICE, `Kotlin 少了 kind ${kind}`).toContain(`"${kind}"`);
      expect(HOOK, `前端少了 kind ${kind}`).toContain(`'${kind}'`);
    }
  });

  /**
   * 不再走 Tauri 的插件监听注册。
   *
   * 那条路依赖 `plugin:timing-native|registerListener`（内部 Jackson 反射）注册成功，
   * 失败会被前端 `.catch()` 吞掉、`hasListener` 永远 false —— 主人报的「点按只有圆点
   * 展开、计时一动不动」正是这么来的。谁把它加回来，这里先红。
   */
  it('does_not_depend_on_plugin_listener_registration', () => {
    expect(HOOK, '前端又在用 addPluginListener 了').not.toContain('addPluginListener');
    expect(PLUGIN, '插件又用 hasListener 判能力了').not.toContain('hasListener(');
    expect(PLUGIN, '插件又用 trigger 投事件了').not.toContain('trigger(event');
    expect(PLUGIN, '没有把 JS 丢给 WebView 执行').toContain('evaluateJavascript');
  });

  /**
   * 投出去不等于执行了：1.2 秒后要能自己发现「没人接」。
   * 判据盯的是**核对函数本身**（标记还在 + 快照没变 → 写 lastTapError），不是符号名。
   */
  it('tap_is_verified_after_dispatch', () => {
    expect(SERVICE).toContain('VERIFY_MS');
    const at = SERVICE.indexOf('private fun verify(');
    expect(at, '没有 verify：失败又只能是「什么都没发生」').toBeGreaterThanOrEqual(0);
    const body = SERVICE.slice(at, SERVICE.indexOf('private fun expandTemporarily', at));
    expect(body, '核对不看标记').toContain('pendingAction(this)');
    expect(body, '核对不看快照变化').toContain('overlaySnapshot(this)');
    expect(body, '核对失败没有留下可见原因').toContain('lastTapError =');
  });

  /** 长按要落在**计时页**（主人原话「应跳转至计时界面」），落点由前端定。 */
  it('long_press_lands_on_the_timer_tab', () => {
    expect(SERVICE, '长按没有把 open 投给前端').toContain('KIND_OPEN');
    expect(HOOK, '前端收到 open 没有切到计时页').toContain("setTab('timer')");
    /* 长按仍要真的把 App 拉起来：只切 Tab 不拉 Activity，用户还在别人 App 里 */
    expect(SERVICE, '长按不再打开主界面了').toContain('OverlayNoti.openIntent(this)');
  });

  /**
   * [V0.11.32] 点按时若待机，记的是**未命名**的一笔。
   *
   * 悬浮条上没有"选事项"的位置：拿 lastItemId 去开始，用户会得到一条挂在上次那件事上的
   * 记录（而他这次做的可能是别的事）。未命名 + 结束时补名字，才是主人说的那个用法。
   */
  it('tap_from_idle_starts_an_unnamed_timer', () => {
    expect(HOOK, '待机点按没有用「未归类」开始').toContain('start(SYSTEM_ITEM_ID)');
    expect(HOOK, '没有引入系统事项常量').toContain('SYSTEM_ITEM_ID');
  });

  /**
   * 切状态前必须先向 Rust 要真值：App 在后台这段时间 store 里的 status 可能是旧的，
   * 拿旧值判断会发出一条必然被拒的命令 —— 用户看到的还是「点了没反应」。
   */
  it('tap_refreshes_the_truth_before_deciding', () => {
    const at = HOOK.indexOf('const run = async');
    expect(at, '没有 run：动作没有共同入口').toBeGreaterThanOrEqual(0);
    const body = HOOK.slice(at);
    const refresh = body.indexOf('refresh()');
    const status = body.indexOf('.state.status');
    expect(refresh, '切状态前没有 refresh').toBeGreaterThanOrEqual(0);
    expect(status, '没有读状态就切？').toBeGreaterThan(refresh);
  });
});
