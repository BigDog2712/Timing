/**
 * Timing — 意图执行端：**事项 ↔ 应用绑定**（[0.13 fix] 「燕云启动了却不计时」）。
 *
 * ## 它修的到底是什么
 *
 * 分析窗里「应用 → 事项」的绑定（应用排行卡双击 → 绑定事项 / 数据页应用设置里的
 * 事项清单）一直只写**分析窗自己的配置表**（`__app_item_binding::<exe>` 与
 * `__app_override::<exe>` 的 `itemBindings[]`）。而药丸的自动接管读的是**宿主业务库的
 * `item_app` 表**（`list_items_for_app`）。两张表之间原本只有一次性的旧配置回填
 * （`services/insight/data/legacy_bindings.rs` + 守卫键 `__migration_item_centric::v1`），
 * 回填跑完之后**新绑的东西永远进不了 `item_app`** —— 症状就是用户报的那句：
 * 「我启动了燕云，但没有开始计时」。零报错、两端日志干净。
 *
 * 所以这里补的是**镜像写**：分析窗保存绑定后发一条意图，药丸用宿主既有的
 * `bind_item_app` / `unbind_item_app` 把 `item_app` 拉成同一份事实。
 * 命令面零改动（契约里的命令数一个不动），符合 §6.4「分析窗只发意图、药丸执行」。
 *
 * ## 为什么载荷是「这个应用绑了哪几个事项」的**全集**
 *
 * 每次同步都提交该应用这一侧想要的**完整** `itemIds` 集合，这里做三向 diff：
 * 多了的 `unbind`、少了的 `bind`、`track` 变了的重 `bind`。
 * 好处是**幂等**：重复发、乱序发、只发到一半都不会留下半截状态；
 * 反过来说，发信方**必须**知道全集（两个写入口都满足：单事项键是 1:1，
 * 应用设置弹窗持有该应用的全部 `itemBindings`），否则会误删别人的绑定。
 *
 * ## `track` 的语义
 *
 * `1` = 计入该事项的子记录（也是**自动接管**的唯一判据，见 `pickBoundItemId`）；
 * `0` = 仅观察（写进 `item_app` 但不接管计时）。缺省按 `1` —— 这正是绝大多数绑定。
 * 应用设置弹窗里被标成「不计入」（`AppOverride.track === false`）时传 `0`，
 * 这样「我故意不让它接管」不会被这条镜像覆盖成接管。
 */
import { errorText, ipc } from './ipc';
import { useUiStore } from '../stores/uiStore';

/** `activity:host-intent` 里 `sync_app_item_bindings` 的载荷（字段名与 gateway 侧逐字一致） */
export interface SyncAppItemBindingsIntent {
  /** 活动库归一后的应用键（`normalize_app_key` / `sessions.app_key` 的同一个值） */
  appKey: string;
  /** 该应用**应该**绑定的事项全集；空数组 = 全部解绑 */
  itemIds: readonly number[];
  /** 1 = 计入并接管计时（缺省）；0 = 仅观察 */
  track?: number;
}

/**
 * 洗一遍事项 id：丢掉非正整数与重复项（`Set` 保证 diff 不会把同一条 `bind` 打两次）。
 * 脏值**静默丢弃**而不是抛：这条意图来自另一个窗，抛出去只会在药丸上弹一个
 * 用户看不懂的错误，而少一条绑定下一次保存就会自己补上。
 */
export function normalizeBoundItemIds(raw: readonly number[] | undefined): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const value of raw) {
    if (!Number.isSafeInteger(value) || value <= 0) continue;
    seen.add(value);
  }
  return [...seen].sort((left, right) => left - right);
}

/**
 * 把宿主 `item_app` 该应用那一侧拉成 `intent.itemIds`。
 *
 * 失败只 `setNotice(danger)` 弹在**药丸**上（§6.5「跨窗只传意图，不传错误」）：
 * 用户在分析窗点的保存，如果库里没写进去，他必须看得见 —— 否则又是同一类
 * 「界面显示已绑定、实际没有」的零报错失效。
 */
export async function applySyncAppItemBindingsIntent(
  intent: SyncAppItemBindingsIntent,
): Promise<void> {
  const appKey = intent.appKey.trim();
  if (!appKey) return;
  const wanted = normalizeBoundItemIds(intent.itemIds);
  /* 只有明确的 `0` 才是「仅观察」，其余（缺省 / 脏值）一律 1：默认值选错方向的代价
     （不接管）比选另一头（误接管）更难排查。 */
  const track = intent.track === 0 ? 0 : 1;
  try {
    const existing = await ipc.listItemsForApp({ appKey });
    for (const row of existing) {
      if (wanted.includes(row.itemId)) continue;
      await ipc.unbindItemApp({ itemId: row.itemId, appKey });
    }
    for (const itemId of wanted) {
      const row = existing.find((entry) => entry.itemId === itemId);
      if (row && row.track === track) continue;
      await ipc.bindItemApp({ itemId, appKey, track });
    }
  } catch (err) {
    useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
  }
}
