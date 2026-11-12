/**
 * 事项「默认时长」在**意图通道**上的唯一写入点（[本轮]，从 `hostIntentBridge` 拆出的第三份 helper）。
 *
 * 范围说清楚：药丸自己的「常用事项管理」卡（`components/menu/ItemsPrefsMenu.tsx:117,123`）
 * 仍在用它自己的 `patchSettings` 直接写 `itemsTimers`，**不经过**这里的队列。那条路径是
 * 本轮之前就有的，触发面只在「两个窗口同时改不同事项的时长」；要彻底消掉竞态，得把它也
 * 收口到 `writeItemTimer`（独立改造，别顺手改）。
 *
 * 为什么单独成文件：`hostIntentBridge.ts` 已经**正好 300 行**（`scripts/check-size.mjs`
 * 的棘轮，判据 `> 300` 才红），零余量 —— 再往里加一段就等于把下一个改这个文件的人逼到
 * 「要么拆、要么违规」。而这段逻辑本来就不属于意图分发：它是「settings 里一个 KV 的
 * 读-改-写」，与 `patina:host-intent` 的协议无关。
 *
 * ## 两条纪律，缺一条就丢用户数据
 *
 * 1. **串行**：Rust 的 `update_settings` 对 `itemsTimers` 是**整键替换**。真实现
 *    （`src-tauri/src/services/settings.rs:220-224`，下面是**意译**，不是原文）：
 *      `if let Some(map) = patch.items_timers.as_ref() { 归一化后整表写回 KEY_ITEMS_TIMERS }`
 *    注意它还会 `normalize_item_timers` —— 超界值与非整数 id 被**静默丢弃**（无日志），
 *    这正是"空基底覆盖"危害大的原因：用户看不到任何报错，时长就没了。
 *    所以两次快速保存（比如连点两条的「保存」）若并发，就会**读到同一份旧基底** →
 *    后写的那次把前一条的改动整片盖掉。队列保证「读基底 → 拼 → 写」一条一条来。
 * 2. **冷启动兜底**：`useAppBootstrap` 的 `Promise.all` 一旦有一个 reject，settings store
 *    会停在 `DEFAULT_SETTINGS`（`itemsTimers: {}`，`loaded: false`）。这时候写一条时长
 *    等于**拿空基底整表覆盖**，把宿主里所有其它事项的时长清掉。所以基底不可信时先
 *    `reload()` 一次，拿到真快照再拼。
 *
 * 基底**必须在队列任务内部读**：在函数入口读就等于没有队列（入口读的那一刻两次调用
 * 拿到同一份旧基底，串行也白搭）。失败也不能卡死队列 —— 见 `queue` 的 catch 兜底。
 */
import { settingsApi } from './api';
import { withItemTimer } from '../lib/commonItems';
import { useSettingsStore } from '../stores/settingsStore';

/** 串行闸门：只用来排队，本身不承载结果（失败已在 `run` 里抛给调用方） */
let queue: Promise<void> = Promise.resolve();

/**
 * 把某事项的默认时长写进 `settings.itemsTimers`（itemId → 分钟；`null` = 删键回正计时）。
 *
 * 三态语义由 `withItemTimer` 承担（它基于当前基底展开，**只动一个键**，其余事项原样保留）。
 * 返回的 Promise 在**这一次**写入落库后 resolve / reject，调用方可据此决定是否提示失败。
 */
export function writeItemTimer(itemId: number, minutes: number | null): Promise<void> {
  const run = async () => {
    const store = useSettingsStore.getState();
    if (!store.loaded) await store.reload();
    /* 必须在这里（队列任务内部）重新取一份：上一环可能刚写完 */
    const base = useSettingsStore.getState().settings.itemsTimers;
    const saved = await settingsApi.update({ itemsTimers: withItemTimer(base, itemId, minutes) });
    useSettingsStore.getState().setSettings(saved);
  };
  /* `queue.then(run, run)`：上一环成功或失败都继续往下跑（失败不能卡死后面所有写入） */
  const next = queue.then(run, run);
  queue = next.then(() => undefined, () => undefined);
  return next;
}
