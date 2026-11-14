/**
 * 「切到绑定了事项的应用，就自动接管计时」（[0.13] 主人口径）。
 *
 * 原话：「在绑定事项的应用首次开启时，自动结束当前计时，并以应用绑定事项开始计时」。
 *
 * ## 接线
 *
 * Rust 追踪引擎在前台窗口**真的变了**时 `emit` 一次 `active-window-changed`
 * （`runtime.rs` 的 `did_change_active_window` 分支 —— 每秒轮询里只有变化才发，
 * 所以"首次进入这个应用"天然就是一次事件，不需要前端自己去重时间窗）。药丸常驻主窗，
 * 订阅一次即可。
 *
 * **只靠事件不够（[0.13 R4]）**：冷启动时（开机自启 / 先开游戏再开我们）那次广播早于本组件
 * 订阅，直接丢了，而之后窗口不再变化就永远不会再发。所以订阅之后**再主动取一次**当前前台
 * （`ipc.getForegroundWindow`，宿主命令 `get_foreground_window`），喂给同一个处理函数。
 *
 * ## 三条边界
 *
 *   1. **同一个应用只接管一次**：`handledKeyRef` 记上一次**真的接管过**的键。窗口标题变了、
 *      或者同一应用连发两次（引擎侧策略变化）都不该重复 `switch` —— 那会把用户刚手动切到
 *      别的事项的计时又拽回去。两条"记账纪律"（[0.13 fix]，缺一条就退化成"绑了不计时"）：
 *        · **只在接管成功之后才写**：没查到绑定 / 查询失败时不能写，否则「先开游戏 →
 *          发现没计时 → 当场绑上 → 切回来」这条真实路径会被一次错过锁死；
 *        · **离开到别的应用时清空**（`frontKeyRef` 记上一次看到的前台应用）：否则
 *          「接管过 A → 去 B → 回到 A」会被 A 的旧记录挡死，与上一条是同一类失效。
 *   2. **正在计这个事项就什么都不做**：`startOrSwitch` 自己也会判，但这里先判一次是为了
 *      不白打两次 IPC（`list_items_for_app` 之后还有一次 `get_timer_state` 收敛）。
 *   3. **失败不打扰用户、也不记键**：走 `startOrSwitch(itemId, { silent: true })` ——
 *      用户没点任何东西，弹一句"开始计时失败"只会让人困惑；而回值 `false` 表示这一次
 *      **没接上**，那就**不许**写 `handledKeyRef`（写了下一次就再也不重试了）。
 *      真正的失败（比如事项已被删除）下一次前台变化会自己再试一遍。
 *   4. **自家窗口不算"离开了应用"**：点药丸时前台会变成 `timing.exe`，随后点回游戏。
 *      若那时清了 `handledKeyRef`，用户刚手动切走的事项就会被"回到游戏"重新拽回去
 *      —— 所以自家进程到前台直接返回，两个 ref 都不动。
 *
 * ## 为什么用 `startOrSwitch` 而不是 `stop + start`
 *
 * `startOrSwitch` 对 running 的处理是「先 pause 冻结累计，再 `switch(end_and_start)` 分段」
 * ——这正是"结束当前计时、以新事项开始"的语义（后端只接受非运行中会话做 switch，见
 * `useTimerActions` 的注释）。直接 `stop` 会额外产生一条"已结束记录 + 一条新记录"的
 * 观感差异（历史页会看到两段），而分段是用户本来就在做的事。
 */
import { useEffect, useRef } from "react";

import { normalizeAppKey } from "../../shared/appKey.ts";
import { ACTIVE_WINDOW_CHANGED_EVENT, readActiveWindowExe } from "../../shared/hostEvents.ts";
import { useTauriEvent } from "./useTauriEvent";
import { useTimerActions } from "./useTimerActions";
import { ipc } from "../services/ipc";
import { useTimerStore } from "../stores/timerStore";

/** 一条 `item_app` 绑定（只取这里要用的两列：`ipc.listItemsForApp` 的返回是它的超集） */
export interface BoundItemRef {
  itemId: number;
  track?: number;
}

/**
 * 本程序自己的可执行文件名（`src-tauri/Cargo.toml` 的 `[package] name = "timing"` →
 * `timing.exe`；`normalizeAppKey` 只小写 ASCII，所以这里写小写即可）。
 *
 * 为什么要单独认它：药丸本身就是我们进程的一个窗口，用户点它的时候前台窗口会变成
 * **我们自己**。Rust 侧判自家进程用 `std::process::id()`
 * （`infra/insight/windows/foreground.rs:135`），前端只拿得到 exe 名，所以按名字判。
 */
const SELF_EXE_KEY = "timing.exe";

/**
 * 从某个应用的全部绑定里挑出"该接管的那一个"。
 *
 * 只认 `track === 1`（0 = 仅观察、不计入子记录，见 `models/item_app.rs`）；多条时取
 * `itemId` **最小**的那条 —— 必须有一个确定答案，否则"同一个应用绑了两个事项"会让
 * 结果取决于数据库返回顺序（用户看到的是"有时候切过去计的是 A，有时候是 B"）。
 */
export function pickBoundItemId(bindings: readonly BoundItemRef[]): number | null {
  let picked: number | null = null;
  for (const binding of bindings) {
    if (binding.track !== undefined && binding.track !== 1) continue;
    if (!Number.isSafeInteger(binding.itemId) || binding.itemId <= 0) continue;
    if (picked === null || binding.itemId < picked) picked = binding.itemId;
  }
  return picked;
}

export function useAppBindingAutoTimer(): void {
  const { startOrSwitch } = useTimerActions();
  /** 上一次看到的**前台应用**（含"没绑定→直接返回"的那些：它们也要算"我离开过了"） */
  const frontKeyRef = useRef<string | null>(null);
  /** 上一次**真的接管成功**的应用键。只有它能挡住重复接管。 */
  const handledKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  /**
   * 一个入口，两个来源：引擎广播（`active-window-changed`）与「挂载后主动查一次」。
   *
   * 必须共用：两条路各自演进一定漂移，而漂移的表现是**冷启动那条悄悄失效**（事件那条还有测试看着）。
   * 参数是「前台进程名」，`null` / 空串 = 不知道，直接返回。
   */
  const handleForeground = (rawExe: string | null): void => {
    const appKey = normalizeAppKey(rawExe ?? "");
    if (!appKey) return;
    /* 自家窗口（药丸 / 分析窗）到前台 = 用户点了我们，**不是**离开了那个应用。
       这一步必须在下面两个 ref 之前：清掉 `handledKeyRef` 的后果是"点回游戏就重新接管"，
       会把用户刚手动切走的事项拽回来（产品口径：点药丸回游戏不许把用户拽回去）。
       主动查询那条路同样要过这一关：冷启动时药丸很可能就在前台。 */
    if (appKey === SELF_EXE_KEY) return;
    /* 前台换到**别的**应用了 → 忘掉"已接管"：用户离开再回到同一个应用，本来就该重新接管
       （下面的 `handledKeyRef === appKey` 才真的表示"同一应用重复广播"）。
       这一步必须放在去重判断**之前**，否则「A → B → A」会被 A 的旧记录挡死。 */
    if (frontKeyRef.current !== appKey) handledKeyRef.current = null;
    frontKeyRef.current = appKey;
    /* 同一应用已接管过：不重复（手动切走之后不该被拽回来） */
    if (handledKeyRef.current === appKey) return;
    /* 上一次还在查绑定：这一条丢掉（下一次前台变化会再来），别让两条并发 switch 打架 */
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    void (async () => {
      try {
        const bindings = await ipc.listItemsForApp({ appKey });
        const itemId = pickBoundItemId(bindings as readonly BoundItemRef[]);
        /* 没绑定 → **不记** `handledKeyRef`。用户当场去绑（事项编辑弹层 / 应用卡的双击菜单）
           再切回同一个应用时必须能补上 —— 先记下来的话就是「一次错过、永不接管」，
           而这条时序正是本 bug 的真实复现路径：先开游戏 → 发现没计时 → 绑上 → 切回来。 */
        if (itemId === null) return;
        const current = useTimerStore.getState().state;
        if (current.status !== "idle" && current.session?.itemId === itemId) {
          /* 已经在计这一件：记下键，省掉同一应用后续每一次无意义的查询 */
          handledKeyRef.current = appKey;
          return;
        }
        const started = await startOrSwitch(itemId, { silent: true });
        /* 只有**真的接管过**才记：`false` = 没接上（事项被删 / IPC 报错），记下就再也不重试了。
           `silent: true` 保证这条链失败时**不弹 notice**（用户没点任何东西）。 */
        if (!started) return;
        handledKeyRef.current = appKey;
      } catch (error) {
        /* 自动接管失败不打扰用户：没点任何东西却弹一句错误只会让人困惑 */
        console.warn("auto timer for bound app failed", appKey, error);
      } finally {
        inFlightRef.current = false;
      }
    })();
  };

  /** handler 走 ref 转发：订阅只建一次，不因每次渲染的新闭包重建（同 `useTauriEvent` 的做法）。 */
  const handlerRef = useRef(handleForeground);
  handlerRef.current = handleForeground;

  useTauriEvent<unknown>(ACTIVE_WINDOW_CHANGED_EVENT, (payload) => {
    handlerRef.current(readActiveWindowExe(payload));
  });

  /**
   * [0.13 R4] 冷启动补一刀：引擎只在**前台真的变了**时广播，而冷启动那次广播早于本组件订阅
   * （开机自启，或先开游戏再开我们），直接丢了；之后窗口不再变化就永远不会再发 —— 用户看到的是
   * 「游戏明明在前台，就是不计时」。所以订阅之后主动取一次当前前台，喂给**同一个**处理函数。
   *
   * 边界：查不到 / 抛错**静默跳过**（这条每次启动都跑，一次失败不该在控制台留噪声）；
   * 不许绕过 `handledKeyRef` / `inFlightRef`（否则就成了"启动就接管"，会把用户手动计的时拽走）；
   * 只跑一次（`queriedRef`），之后完全靠事件。
   */
  const queriedRef = useRef(false);
  useEffect(() => {
    if (queriedRef.current) return;
    queriedRef.current = true;
    void (async () => {
      try {
        const window = await ipc.getForegroundWindow();
        if (window?.exeName) handlerRef.current(window.exeName);
      } catch {
        /* 静默：桌面壳 / 锁屏 / 追踪还没起都可能回空或报错，那是启动期的常态，不是错误 */
      }
    })();
  }, []);
}
